import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronRight, Clock, Crown, LayoutGrid, Sparkles, Trophy, Users } from 'lucide-react';

import { Avatar } from './Avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { formatDuration, getMatchPoint, getWinner } from '../lib/game';
import { cn } from '../lib/utils';
import type { GameHistoryItem, Player, Score, TeamName } from '../lib/types';

// ── Live session shape (mirrors what OpenPlayPage persists to localStorage) ─

type SnapshotCourt = {
  id: string;
  teamA: number[];
  teamB: number[];
  startedAt: number | null;
  score: Score;
};

type SnapshotSession = {
  courtCount: number;
  checkedIn: number[];
  queue: number[];
  courts: SnapshotCourt[];
  gamesPlayed: Record<number, number>;
  startedAt: number;
  durationMinutes: number | null;
  recordedGames: { id: number }[];
};

function readActiveSession(): SnapshotSession | null {
  try {
    const raw = localStorage.getItem('pikol-openplay');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.courts) || !Array.isArray(parsed.queue)) return null;
    return parsed as SnapshotSession;
  } catch {
    return null;
  }
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatHoursMinutes(totalSeconds: number) {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ────────────────────────────────────────────────────────────────────────────

export function DashboardPage({
  players,
  history,
  onGoToOpenPlay,
}: {
  players: Player[];
  history: GameHistoryItem[];
  onGoToOpenPlay: () => void;
}) {
  // Read the live session snapshot on mount and poll once a second while it's
  // open. localStorage is shared with OpenPlayPage so the snapshot stays fresh.
  const [session, setSession] = useState<SnapshotSession | null>(() => readActiveSession());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = () => {
      setSession(readActiveSession());
      setNow(Date.now());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const resolve = (ids: number[]) =>
    ids.map((id) => playersById.get(id)).filter((p): p is Player => Boolean(p));

  // Today (calendar-anchored)
  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, [now]); // recompute if the clock rolls past midnight while open

  const todayGames = useMemo(
    () => history.filter((g) => g.playedAt >= todayStartMs),
    [history, todayStartMs],
  );

  const todaySeconds = todayGames.reduce((sum, g) => sum + g.durationSeconds, 0);

  // Today's most-played player (count distinct active players today too)
  const todayCounts = useMemo(() => {
    const map = new Map<number, { games: number; wins: number; name: string }>();
    for (const game of todayGames) {
      const winnerIds = new Set(
        (game.winner === 'Team A' ? game.teamA : game.teamB).map((p) => p.id),
      );
      for (const snap of [...game.teamA, ...game.teamB]) {
        const entry = map.get(snap.id) ?? { games: 0, wins: 0, name: snap.name };
        entry.games += 1;
        if (winnerIds.has(snap.id)) entry.wins += 1;
        map.set(snap.id, entry);
      }
    }
    return [...map.entries()]
      .map(([id, e]) => ({ id, ...e }))
      .sort((a, b) => b.games - a.games);
  }, [todayGames]);

  const recentGames = useMemo(() => history.slice(0, 5), [history]);

  const checkedInCount = session
    ? session.checkedIn.filter((id) => playersById.has(id)).length
    : 0;
  const sessionEndsAt =
    session && session.durationMinutes != null
      ? session.startedAt + session.durationMinutes * 60_000
      : null;
  const remainingMs = sessionEndsAt != null ? Math.max(0, sessionEndsAt - now) : null;

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Live status, today's results, and recent activity.</p>
      </div>

      {session ? (
        <LiveSessionCard
          session={session}
          now={now}
          checkedInCount={checkedInCount}
          remainingMs={remainingMs}
          resolve={resolve}
          onGoToOpenPlay={onGoToOpenPlay}
        />
      ) : (
        <IdleCard
          totalGames={history.length}
          totalPlayers={players.length}
          onGoToOpenPlay={onGoToOpenPlay}
        />
      )}

      {/* Today snapshot */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Trophy size={12} />} label="Games today" value={todayGames.length} />
        <StatTile icon={<Users size={12} />} label="Players today" value={todayCounts.length} />
        <StatTile
          icon={<Clock size={12} />}
          label="Court time today"
          value={todayGames.length > 0 ? formatHoursMinutes(todaySeconds) : '—'}
        />
        <StatTile
          icon={<Activity size={12} />}
          label="MVP today"
          value={todayCounts[0] ? todayCounts[0].name : '—'}
          sub={todayCounts[0] ? `${todayCounts[0].games} games` : undefined}
        />
      </div>

      {/* Recent games */}
      <Card className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent games</h2>
          <Badge variant="outline">{history.length} total</Badge>
        </div>
        {recentGames.length > 0 ? (
          <div className="flex flex-col">
            {recentGames.map((game, index) => (
              <RecentGameRow
                game={game}
                gameNumber={history.length - index}
                divider={index !== recentGames.length - 1}
                key={game.id}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No games recorded yet — start a session to begin.</p>
        )}
      </Card>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function LiveSessionCard({
  session,
  now,
  checkedInCount,
  remainingMs,
  resolve,
  onGoToOpenPlay,
}: {
  session: SnapshotSession;
  now: number;
  checkedInCount: number;
  remainingMs: number | null;
  resolve: (ids: number[]) => Player[];
  onGoToOpenPlay: () => void;
}) {
  const queueIds = session.queue.slice(0, 3);
  const queuePlayers = resolve(queueIds);

  return (
    <Card className="relative flex flex-col gap-4 overflow-hidden p-4">
      {/* Glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/20 opacity-50 blur-3xl"
      />

      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/20 text-primary">
              <Sparkles size={12} />
            </span>
            Open play · Live
            <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {checkedInCount} in · {session.courts.length}/{session.courtCount} courts ·{' '}
            {session.recordedGames.length}{' '}
            {session.recordedGames.length === 1 ? 'game' : 'games'} played
          </p>
        </div>
        <Button onClick={onGoToOpenPlay} size="sm">
          Open <ChevronRight size={14} />
        </Button>
      </div>

      {remainingMs != null && (
        <div className="relative flex items-baseline justify-between gap-2">
          <span className="font-mono text-3xl font-black leading-none tabular-nums">
            {formatCountdown(remainingMs)}
          </span>
          <span className="text-xs text-muted-foreground">remaining</span>
        </div>
      )}

      {session.courts.length > 0 ? (
        <div className="flex flex-col gap-2">
          {session.courts.map((court, index) => (
            <CourtSnapshot
              key={court.id}
              index={index + 1}
              court={court}
              teamA={resolve(court.teamA)}
              teamB={resolve(court.teamB)}
              now={now}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No courts seated yet.</p>
      )}

      {queuePlayers.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Up next</span>
          <div className="flex items-center gap-1">
            {queuePlayers.map((p) => (
              <Avatar key={p.id} name={p.name} size={20} />
            ))}
          </div>
          <span className="truncate">{queuePlayers.map((p) => p.name).join(', ')}</span>
          {session.queue.length > queueIds.length && (
            <span>· +{session.queue.length - queueIds.length} more</span>
          )}
        </div>
      )}
    </Card>
  );
}

function CourtSnapshot({
  index,
  court,
  teamA,
  teamB,
  now,
}: {
  index: number;
  court: SnapshotCourt;
  teamA: Player[];
  teamB: Player[];
  now: number;
}) {
  const winner = getWinner(court.score) as TeamName | null;
  const matchPoint = getMatchPoint(court.score);
  const started = court.startedAt != null;
  const elapsed = started ? Math.max(0, Math.floor((now - court.startedAt!) / 1000)) : 0;

  const status = winner
    ? 'winner'
    : !started
      ? 'warmup'
      : matchPoint === 'Team A' || matchPoint === 'Team B'
        ? 'matchpoint'
        : 'live';

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-primary">
          <LayoutGrid size={14} />
        </span>
        <div>
          <p className="text-sm font-bold leading-tight">Court {index}</p>
          <p className="font-mono text-[10px] leading-tight text-muted-foreground">
            {started ? formatDuration(elapsed) : '—:—'}
          </p>
        </div>
      </div>

      <div className="grid min-w-0 flex-1 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <CourtTeamMini
          players={teamA}
          score={court.score.teamA}
          isWinner={winner === 'Team A'}
          align="right"
        />
        <span className="text-xs font-semibold uppercase text-muted-foreground">vs</span>
        <CourtTeamMini
          players={teamB}
          score={court.score.teamB}
          isWinner={winner === 'Team B'}
          align="left"
        />
      </div>

      <StatusPill status={status} />
    </div>
  );
}

function CourtTeamMini({
  players,
  score,
  isWinner,
  align,
}: {
  players: Player[];
  score: number;
  isWinner: boolean;
  align: 'left' | 'right';
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-2', align === 'right' && 'flex-row-reverse')}>
      <span
        className={cn(
          'text-2xl font-black tabular-nums leading-none',
          isWinner ? 'text-success' : 'text-foreground',
        )}
      >
        {score}
      </span>
      <p className="min-w-0 truncate text-xs font-semibold">
        {players.length > 0 ? players.map((p) => p.name).join(' & ') : '—'}
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: 'warmup' | 'live' | 'matchpoint' | 'winner' }) {
  if (status === 'warmup') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        Warm
      </span>
    );
  }
  if (status === 'live') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Live
      </span>
    );
  }
  if (status === 'matchpoint') {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        MP
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
      <Crown size={10} />
      Won
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function IdleCard({
  totalGames,
  totalPlayers,
  onGoToOpenPlay,
}: {
  totalGames: number;
  totalPlayers: number;
  onGoToOpenPlay: () => void;
}) {
  return (
    <Card className="relative flex flex-wrap items-center justify-between gap-4 overflow-hidden p-4">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/10 opacity-50 blur-3xl"
      />
      <div className="relative">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-muted text-muted-foreground">
            <Sparkles size={12} />
          </span>
          No live session
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalPlayers} {totalPlayers === 1 ? 'player' : 'players'} on the roster ·{' '}
          {totalGames} {totalGames === 1 ? 'game' : 'games'} recorded all-time.
        </p>
      </div>
      <Button onClick={onGoToOpenPlay} className="relative">
        Start open play <ChevronRight size={14} />
      </Button>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function StatTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <Card className="flex flex-col gap-1.5 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/20 text-primary">{icon}</span>
        {label}
      </div>
      <p className="truncate text-xl font-extrabold leading-none tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function RecentGameRow({
  game,
  gameNumber,
  divider,
}: {
  game: GameHistoryItem;
  gameNumber: number;
  divider: boolean;
}) {
  const winnerIsA = game.winner === 'Team A';
  const playedDate = new Date(game.playedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className={cn('flex flex-col gap-1.5 py-3', divider && 'border-b border-border/60')}>
      <div className="flex items-center justify-between gap-2">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {gameNumber}
        </span>
        <p className="text-[11px] text-muted-foreground">{playedDate}</p>
      </div>

      <RecentTeamLine players={game.teamA} score={game.score.teamA} isWinner={winnerIsA} />
      <RecentTeamLine players={game.teamB} score={game.score.teamB} isWinner={!winnerIsA} />
    </div>
  );
}

function RecentTeamLine({
  players,
  score,
  isWinner,
}: {
  players: GameHistoryItem['teamA'];
  score: number;
  isWinner: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex shrink-0 gap-0.5">
        {players.map((player) => (
          <Avatar key={player.id} name={player.name} size={22} />
        ))}
      </div>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm',
          isWinner ? 'font-bold text-foreground' : 'text-muted-foreground',
        )}
      >
        {players.map((player) => player.name).join(' & ')}
      </span>
      {isWinner && <Crown size={12} className="shrink-0 text-success" aria-label="winner" />}
      <span
        className={cn(
          'w-8 shrink-0 text-right font-mono text-base font-bold tabular-nums',
          isWinner ? 'text-success' : 'text-muted-foreground',
        )}
      >
        {score}
      </span>
    </div>
  );
}
