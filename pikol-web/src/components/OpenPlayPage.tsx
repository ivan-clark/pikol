import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronRight,
  Clock,
  Crown,
  LayoutGrid,
  Minus,
  Play,
  Plus,
  Trophy,
  UserPlus,
  X,
} from 'lucide-react';

import { Avatar } from './Avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { api } from '../lib/api';
import { formatDuration, getMatchPoint, getWinner } from '../lib/game';
import { cn } from '../lib/utils';
import type { GameHistoryItem, Player, Score, TeamName } from '../lib/types';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'pikol-openplay';
const MAX_COURTS = 6;
const LAST_CALL_MINUTES = 15;

const DURATION_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No limit', value: null },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
  { label: '3h', value: 180 },
  { label: '4h', value: 240 },
];

// ============================================================================
// Types
// ============================================================================

type Court = {
  id: string;
  teamA: number[];
  teamB: number[];
  startedAt: number | null; // null while warming up
  score: Score;
};

type OpenPlaySession = {
  courtCount: number;
  checkedIn: number[];
  queue: number[];
  courts: Court[];
  gamesPlayed: Record<number, number>;
  startedAt: number;
  durationMinutes: number | null;
};

type CourtStatus = 'warmup' | 'live' | 'matchpoint' | 'winner';

// ============================================================================
// Pure helpers
// ============================================================================

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getCourtStatus(court: Court): CourtStatus {
  if (court.startedAt == null) return 'warmup';
  if (getWinner(court.score)) return 'winner';
  const mp = getMatchPoint(court.score);
  if (mp === 'Team A' || mp === 'Team B') return 'matchpoint';
  return 'live';
}

function loadStoredSession(): OpenPlaySession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenPlaySession>;
    if (!parsed || !Array.isArray(parsed.courts) || !Array.isArray(parsed.queue)) return null;
    return {
      courtCount: parsed.courtCount ?? 2,
      checkedIn: parsed.checkedIn ?? [],
      queue: parsed.queue ?? [],
      courts: parsed.courts ?? [],
      gamesPlayed: parsed.gamesPlayed ?? {},
      startedAt: parsed.startedAt ?? Date.now(),
      durationMinutes: parsed.durationMinutes ?? null,
    };
  } catch {
    return null;
  }
}

// Stable sort: fewest games this session first, queue position as the tiebreak.
function fairOrder(session: OpenPlaySession) {
  return [...session.queue].sort((a, b) => (session.gamesPlayed[a] ?? 0) - (session.gamesPlayed[b] ?? 0));
}

function sessionEndsAt(session: OpenPlaySession) {
  return session.durationMinutes != null ? session.startedAt + session.durationMinutes * 60_000 : null;
}

// ============================================================================
// Main component
// ============================================================================

export function OpenPlayPage({
  players,
  onResult,
}: {
  players: Player[];
  onResult: (updatedPlayers: Player[], game: GameHistoryItem) => void;
}) {
  const [session, setSession] = useState<OpenPlaySession | null>(() => loadStoredSession());
  const [setupCourts, setSetupCourts] = useState(2);
  const [setupDuration, setSetupDuration] = useState<number | null>(180);
  const [setupSelected, setSetupSelected] = useState<Set<number>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Open swap picker for { which court · which on-court player } we're replacing.
  const [swapTarget, setSwapTarget] = useState<{ courtId: string; playerId: number } | null>(null);

  const playersById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const resolve = (ids: number[]) =>
    ids.map((id) => playersById.get(id)).filter((player): player is Player => Boolean(player));

  // Persist the live session so a refresh doesn't lose courts/queue.
  useEffect(() => {
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore unavailable storage
    }
  }, [session]);

  // Tick once a second to keep court timers and the session countdown live.
  useEffect(() => {
    if (!session) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session]);

  // Default the setup roster to everyone currently marked available.
  useEffect(() => {
    if (session) return;
    setSetupSelected(new Set(players.filter((player) => player.available).map((player) => player.id)));
  }, [session, players]);

  function canSeatNewGames(target: OpenPlaySession, at: number) {
    const endsAt = sessionEndsAt(target);
    if (endsAt == null) return true;
    return endsAt - at > LAST_CALL_MINUTES * 60_000;
  }

  async function computeFill(current: OpenPlaySession): Promise<OpenPlaySession> {
    if (!canSeatNewGames(current, Date.now())) return current;
    const emptySlots = current.courtCount - current.courts.length;
    if (emptySlots <= 0 || current.queue.length < 4) return current;

    const { courts, waiting } = await api.assignCourts(fairOrder(current), emptySlots);
    const seated: Court[] = courts.map((match) => ({
      id: makeId(),
      teamA: match.teamA.map((player) => player.id),
      teamB: match.teamB.map((player) => player.id),
      startedAt: null, // warming up
      score: { teamA: 0, teamB: 0 },
    }));

    return { ...current, courts: [...current.courts, ...seated], queue: waiting.map((player) => player.id) };
  }

  async function startSession() {
    const ids = players.filter((player) => setupSelected.has(player.id)).map((player) => player.id);
    if (ids.length < 4) return;

    setBusy(true);
    setError('');
    try {
      const base: OpenPlaySession = {
        courtCount: setupCourts,
        checkedIn: ids,
        queue: ids,
        courts: [],
        gamesPlayed: {},
        startedAt: Date.now(),
        durationMinutes: setupDuration,
      };
      setSession(await computeFill(base));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start the session.');
    } finally {
      setBusy(false);
    }
  }

  async function fillCourts() {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      setSession(await computeFill(session));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to fill courts.');
    } finally {
      setBusy(false);
    }
  }

  function startCourt(courtId: string) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.map((court) =>
              court.id === courtId && court.startedAt == null ? { ...court, startedAt: Date.now() } : court,
            ),
          }
        : current,
    );
  }

  function adjustScore(courtId: string, team: 'teamA' | 'teamB', delta: number) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.map((court) =>
              court.id === courtId
                ? { ...court, score: { ...court.score, [team]: Math.max(0, court.score[team] + delta) } }
                : court,
            ),
          }
        : current,
    );
  }

  function setScore(courtId: string, team: 'teamA' | 'teamB', value: number) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.map((court) =>
              court.id === courtId
                ? { ...court, score: { ...court.score, [team]: Math.max(0, Math.floor(value)) } }
                : court,
            ),
          }
        : current,
    );
  }

  async function recordCourt(court: Court) {
    const winner = getWinner(court.score) as TeamName | null;
    if (!winner || !session || court.startedAt == null) return;

    const teamA = resolve(court.teamA);
    const teamB = resolve(court.teamB);
    if (teamA.length < 2 || teamB.length < 2) return;

    setBusy(true);
    setError('');
    try {
      const result = await api.recordGame({
        match: { teamA, teamB },
        score: court.score,
        winner,
        durationSeconds: Math.max(0, Math.floor((Date.now() - court.startedAt) / 1000)),
        scoringEvents: [],
      });
      onResult(result.players, result.game);

      // Count this game for all four players, rotate them, then refill.
      const played = [...court.teamA, ...court.teamB];
      const gamesPlayed = { ...session.gamesPlayed };
      for (const id of played) gamesPlayed[id] = (gamesPlayed[id] ?? 0) + 1;

      const afterRecord: OpenPlaySession = {
        ...session,
        gamesPlayed,
        courts: session.courts.filter((existing) => existing.id !== court.id),
        queue: [...session.queue, ...played],
      };
      setSession(await computeFill(afterRecord));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to record the game.');
    } finally {
      setBusy(false);
    }
  }

  function clearCourt(court: Court) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.filter((existing) => existing.id !== court.id),
            queue: [...current.queue, ...court.teamA, ...court.teamB],
          }
        : current,
    );
  }

  // Replace a player on a court with someone from the queue. The on-court player
  // goes to the back of the queue; the replacement takes their team slot.
  function executeSwap(replacementId: number) {
    if (!swapTarget) return;
    setSession((current) => {
      if (!current) return current;
      const targetId = swapTarget.playerId;
      return {
        ...current,
        courts: current.courts.map((court) => {
          if (court.id !== swapTarget.courtId) return court;
          const inTeamA = court.teamA.includes(targetId);
          return {
            ...court,
            teamA: inTeamA
              ? court.teamA.map((id) => (id === targetId ? replacementId : id))
              : court.teamA,
            teamB: inTeamA
              ? court.teamB
              : court.teamB.map((id) => (id === targetId ? replacementId : id)),
          };
        }),
        queue: [...current.queue.filter((id) => id !== replacementId), targetId],
      };
    });
    setSwapTarget(null);
  }

  function checkIn(playerId: number) {
    setSession((current) =>
      current && !current.checkedIn.includes(playerId)
        ? { ...current, checkedIn: [...current.checkedIn, playerId], queue: [...current.queue, playerId] }
        : current,
    );
  }

  function removeFromQueue(playerId: number) {
    setSession((current) =>
      current
        ? {
            ...current,
            checkedIn: current.checkedIn.filter((id) => id !== playerId),
            queue: current.queue.filter((id) => id !== playerId),
          }
        : current,
    );
  }

  function changeCourtCount(delta: number) {
    setSession((current) =>
      current
        ? { ...current, courtCount: Math.min(MAX_COURTS, Math.max(1, current.courtCount + delta)) }
        : current,
    );
  }

  function endSession() {
    setSession(null);
    setError('');
  }

  if (!session) {
    return (
      <SetupView
        players={players}
        selected={setupSelected}
        courts={setupCourts}
        duration={setupDuration}
        busy={busy}
        error={error}
        onToggle={(id) =>
          setSetupSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onSelectAll={() => setSetupSelected(new Set(players.map((player) => player.id)))}
        onClear={() => setSetupSelected(new Set())}
        onCourts={(value) => setSetupCourts(Math.min(MAX_COURTS, Math.max(1, value)))}
        onDuration={setSetupDuration}
        onStart={() => void startSession()}
      />
    );
  }

  // ---- Derived state for the live session view -------------------------------

  const benchPlayers = players.filter((player) => !session.checkedIn.includes(player.id));
  const checkedInCount = session.checkedIn.filter((id) => playersById.has(id)).length;
  const queueOrder = fairOrder(session).filter((id) => playersById.has(id));
  const emptyCourts = session.courtCount - session.courts.length;
  const gamesPlayedTotal = Math.floor(
    Object.values(session.gamesPlayed).reduce((sum, count) => sum + count, 0) / 4,
  );
  const endsAt = sessionEndsAt(session);
  const remainingMs = endsAt != null ? Math.max(0, endsAt - now) : null;
  const elapsedMs = now - session.startedAt;
  const totalMs = session.durationMinutes != null ? session.durationMinutes * 60_000 : null;
  const lastCall = endsAt != null && endsAt - now <= LAST_CALL_MINUTES * 60_000 && endsAt - now > 0;
  const timeUp = endsAt != null && endsAt - now <= 0;
  const canSeat = canSeatNewGames(session, now);
  const canFill = emptyCourts > 0 && session.queue.length >= 4 && canSeat;

  const upNextId = queueOrder[0] ?? null;
  const restQueueIds = queueOrder.slice(1);

  return (
    <>
      <SessionHero
        remainingMs={remainingMs}
        elapsedMs={elapsedMs}
        totalMs={totalMs}
        endsAt={endsAt}
        checkedInCount={checkedInCount}
        coursActive={session.courts.length}
        courtCount={session.courtCount}
        gamesPlayedTotal={gamesPlayedTotal}
        lastCall={lastCall}
        timeUp={timeUp}
        onEnd={endSession}
      />

      {error && (
        <Card className="border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      {/* Two columns on wide screens: courts on the left, queue + bench on the right. */}
      <div className="grid items-start gap-3 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Courts</span>
          <div className="flex items-center gap-2">
            <Button onClick={() => changeCourtCount(-1)} size="icon" variant="outline" disabled={session.courtCount <= 1}>
              <Minus size={16} />
            </Button>
            <span className="w-6 text-center text-lg font-bold tabular-nums">{session.courtCount}</span>
            <Button
              onClick={() => changeCourtCount(1)}
              size="icon"
              variant="outline"
              disabled={session.courtCount >= MAX_COURTS}
            >
              <Plus size={16} />
            </Button>
          </div>
        </div>
        <Button onClick={() => void fillCourts()} disabled={!canFill || busy}>
          {busy ? 'Working…' : !canSeat ? 'Last call' : 'Fill courts'}
        </Button>
      </Card>

      <div className="grid gap-3">
        {session.courts.map((court, index) => (
          <CourtCard
            key={court.id}
            index={index + 1}
            court={court}
            teamA={resolve(court.teamA)}
            teamB={resolve(court.teamB)}
            elapsed={court.startedAt != null ? Math.max(0, Math.floor((now - court.startedAt) / 1000)) : 0}
            busy={busy}
            onScore={adjustScore}
            onSetScore={setScore}
            onStart={() => startCourt(court.id)}
            onRecord={() => void recordCourt(court)}
            onClear={() => clearCourt(court)}
            onSwap={(playerId) => setSwapTarget({ courtId: court.id, playerId })}
          />
        ))}
        {Array.from({ length: Math.max(0, emptyCourts) }).map((_, index) => (
          <Card
            key={`empty-${index}`}
            className="grid min-h-44 place-items-center border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground"
          >
            {!canSeat
              ? 'Last call — finishing current games.'
              : session.queue.length >= 4
                ? 'Tap “Fill courts” to seat the next group.'
                : 'Waiting for 4 players in the queue.'}
          </Card>
        ))}
      </div>

        </div>

        <aside className="flex flex-col gap-3">
          <QueueSection
            upNextId={upNextId}
            restIds={restQueueIds}
            playersById={playersById}
            gamesPlayed={session.gamesPlayed}
            onRemove={removeFromQueue}
          />

          {benchPlayers.length > 0 && (
            <Card className="flex flex-col gap-3 p-4">
              <div>
                <h2 className="text-base font-semibold">Bench</h2>
                <p className="text-sm text-muted-foreground">Players not in this session yet — tap to check in.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {benchPlayers.map((player) => (
                  <button
                    key={player.id}
                    onClick={() => checkIn(player.id)}
                    className="flex items-center gap-2 rounded-full border border-border bg-card pl-1 pr-3 py-1 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    <Avatar name={player.name} size={24} />
                    <span>{player.name}</span>
                    <UserPlus size={14} className="text-muted-foreground" />
                  </button>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>

      {swapTarget && (
        <SwapDialog
          target={playersById.get(swapTarget.playerId) ?? null}
          candidates={fairOrder(session)
            .map((id) => playersById.get(id))
            .filter((player): player is Player => Boolean(player))}
          gamesPlayed={session.gamesPlayed}
          onPick={executeSwap}
          onCancel={() => setSwapTarget(null)}
        />
      )}
    </>
  );
}

// ============================================================================
// Session hero — countdown, progress, stats, end action
// ============================================================================

function SessionHero({
  remainingMs,
  elapsedMs,
  totalMs,
  endsAt,
  checkedInCount,
  coursActive,
  courtCount,
  gamesPlayedTotal,
  lastCall,
  timeUp,
  onEnd,
}: {
  remainingMs: number | null;
  elapsedMs: number;
  totalMs: number | null;
  endsAt: number | null;
  checkedInCount: number;
  coursActive: number;
  courtCount: number;
  gamesPlayedTotal: number;
  lastCall: boolean;
  timeUp: boolean;
  onEnd: () => void;
}) {
  const progress = totalMs != null && totalMs > 0 ? Math.min(1, Math.max(0, elapsedMs / totalMs)) : 0;
  const tone = timeUp ? 'destructive' : lastCall ? 'warning' : 'primary';

  return (
    <Card
      className={cn(
        'relative overflow-hidden p-5',
        timeUp && 'border-destructive',
        lastCall && !timeUp && 'border-warning',
      )}
    >
      {/* Subtle accent glow behind the countdown */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-50 blur-3xl',
          tone === 'primary' && 'bg-primary/20',
          tone === 'warning' && 'bg-warning/30',
          tone === 'destructive' && 'bg-destructive/25',
        )}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/20 text-primary">
              <LayoutGrid size={12} />
            </span>
            Open Play
          </p>
          <p className="text-sm text-muted-foreground">
            {checkedInCount} in · {coursActive}/{courtCount} courts · {gamesPlayedTotal}{' '}
            {gamesPlayedTotal === 1 ? 'game' : 'games'} played
          </p>
        </div>
        <Button onClick={onEnd} variant="outline" size="sm">
          End session
        </Button>
      </div>

      {remainingMs != null ? (
        <div className="relative mt-4 space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock
                size={20}
                className={cn(
                  'text-muted-foreground',
                  lastCall && !timeUp && 'text-warning',
                  timeUp && 'text-destructive',
                )}
              />
              <span
                className={cn(
                  'font-mono text-4xl font-black tabular-nums leading-none tracking-tight',
                  timeUp && 'text-destructive',
                )}
              >
                {formatCountdown(remainingMs)}
              </span>
            </div>
            <div className="text-right">
              {timeUp ? (
                <Badge variant="destructive">Time’s up</Badge>
              ) : lastCall ? (
                <Badge variant="warning">Last call</Badge>
              ) : (
                endsAt != null && (
                  <span className="text-sm text-muted-foreground">
                    ends {new Date(endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-700 ease-out',
                tone === 'primary' && 'bg-primary',
                tone === 'warning' && 'bg-warning',
                tone === 'destructive' && 'bg-destructive',
              )}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      ) : (
        <p className="relative mt-3 text-sm text-muted-foreground">No time limit — play as long as you like.</p>
      )}
    </Card>
  );
}

// ============================================================================
// Court card — the pickleball-court visual
// ============================================================================

function CourtCard({
  index,
  court,
  teamA,
  teamB,
  elapsed,
  busy,
  onScore,
  onSetScore,
  onStart,
  onRecord,
  onClear,
  onSwap,
}: {
  index: number;
  court: Court;
  teamA: Player[];
  teamB: Player[];
  elapsed: number;
  busy: boolean;
  onScore: (courtId: string, team: 'teamA' | 'teamB', delta: number) => void;
  onSetScore: (courtId: string, team: 'teamA' | 'teamB', value: number) => void;
  onStart: () => void;
  onRecord: () => void;
  onClear: () => void;
  onSwap: (playerId: number) => void;
}) {
  const winner = getWinner(court.score) as TeamName | null;
  const matchPoint = getMatchPoint(court.score);
  const status = getCourtStatus(court);
  const started = court.startedAt != null;

  return (
    <Card
      className={cn(
        'flex flex-col gap-3 p-4 transition-colors',
        winner && 'border-success/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-primary">
            <LayoutGrid size={16} />
          </span>
          <span className="font-extrabold tracking-tight">Court {index}</span>
          <CourtStatusBadge status={status} winner={winner} />
        </div>
        <span
          className={cn(
            'font-mono text-sm tabular-nums text-muted-foreground',
            !started && 'opacity-40',
          )}
        >
          {started ? formatDuration(elapsed) : '—:—'}
        </span>
      </div>

      {/* Two-side "court" with a dashed net between */}
      <div className="grid grid-cols-2">
        <CourtSide
          team="Team A"
          players={teamA}
          score={court.score.teamA}
          started={started}
          isWinner={winner === 'Team A'}
          isMatchPoint={matchPoint === 'Team A'}
          onAdd={() => onScore(court.id, 'teamA', 1)}
          onSub={() => onScore(court.id, 'teamA', -1)}
          onSet={(value) => onSetScore(court.id, 'teamA', value)}
          onSwap={onSwap}
        />
        <div className="-mx-px border-l border-dashed border-border" />
        <CourtSide
          team="Team B"
          players={teamB}
          score={court.score.teamB}
          started={started}
          isWinner={winner === 'Team B'}
          isMatchPoint={matchPoint === 'Team B'}
          onAdd={() => onScore(court.id, 'teamB', 1)}
          onSub={() => onScore(court.id, 'teamB', -1)}
          onSet={(value) => onSetScore(court.id, 'teamB', value)}
          onSwap={onSwap}
          rightSide
        />
      </div>

      <div className="flex gap-2">
        <Button onClick={onClear} variant="ghost" size="sm" className="flex-1">
          Clear
        </Button>
        {started ? (
          <Button
            onClick={onRecord}
            disabled={!winner || busy}
            variant="success"
            size="sm"
            className={cn('flex-1', winner && 'shadow-md')}
          >
            <Trophy size={14} /> Record game
          </Button>
        ) : (
          <Button onClick={onStart} size="sm" className="flex-1">
            <Play size={14} /> Start game
          </Button>
        )}
      </div>
    </Card>
  );
}

// One side of a court: team label, two avatars + names, big inline score with ±.
function CourtSide({
  team,
  players,
  score,
  started,
  isWinner,
  isMatchPoint,
  onAdd,
  onSub,
  onSet,
  onSwap,
  rightSide,
}: {
  team: string;
  players: Player[];
  score: number;
  started: boolean;
  isWinner: boolean;
  isMatchPoint: boolean;
  onAdd: () => void;
  onSub: () => void;
  onSet: (value: number) => void;
  onSwap: (playerId: number) => void;
  rightSide?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-md p-3 transition-colors',
        rightSide ? 'pl-4' : 'pr-4',
        isWinner && 'bg-success/10',
        isMatchPoint && !isWinner && 'bg-warning/10',
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{team}</span>
        {isWinner && <Crown size={14} className="text-success" />}
      </div>

      <div className="flex flex-col gap-1">
        {players.length > 0 ? (
          players.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => onSwap(player.id)}
              className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/60"
              aria-label={`Swap ${player.name}`}
              title="Tap to swap with the queue"
            >
              <Avatar name={player.name} size={26} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</span>
              <ArrowLeftRight size={12} className="shrink-0 text-muted-foreground opacity-30" />
            </button>
          ))
        ) : (
          <span className="text-xs italic text-muted-foreground">no players</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-center gap-2 pt-1">
        <Button
          onClick={onSub}
          disabled={!started || score === 0}
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          aria-label={`${team} minus one`}
        >
          <Minus size={16} />
        </Button>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={score}
          disabled={!started}
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            // Keep up to two digits so 11–21 fits but garbage like "1abc" is filtered.
            const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 2);
            onSet(digits === '' ? 0 : parseInt(digits, 10));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          aria-label={`${team} score`}
          className={cn(
            'w-14 rounded-md bg-transparent text-center text-4xl font-black tabular-nums leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed',
            isWinner ? 'text-success' : isMatchPoint ? 'text-warning' : 'text-foreground',
            !started && 'opacity-40',
          )}
        />
        <Button
          onClick={onAdd}
          disabled={!started}
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0"
          aria-label={`${team} plus one`}
        >
          <Plus size={16} />
        </Button>
      </div>
    </div>
  );
}

function CourtStatusBadge({ status, winner }: { status: CourtStatus; winner: TeamName | null }) {
  if (status === 'warmup') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
        Warming up
      </span>
    );
  }
  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Live
      </span>
    );
  }
  if (status === 'matchpoint') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/20 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        Match point
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-success/20 px-2.5 py-0.5 text-[11px] font-semibold text-success">
      <Crown size={11} />
      {winner ? `${winner} wins` : 'Winner'}
    </span>
  );
}

// ============================================================================
// Queue — On Deck + the rest
// ============================================================================

function QueueSection({
  upNextId,
  restIds,
  playersById,
  gamesPlayed,
  onRemove,
}: {
  upNextId: number | null;
  restIds: number[];
  playersById: Map<number, Player>;
  gamesPlayed: Record<number, number>;
  onRemove: (id: number) => void;
}) {
  const upNext = upNextId != null ? playersById.get(upNextId) ?? null : null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Up next</h2>
        <Badge variant="outline">{(upNext ? 1 : 0) + restIds.length} waiting</Badge>
      </div>

      {upNext ? (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
          <Avatar name={upNext.name} size={40} />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">On deck</p>
            <p className="truncate text-base font-bold">{upNext.name}</p>
          </div>
          <Badge variant="default">{gamesPlayed[upNext.id] ?? 0} games</Badge>
          <ChevronRight size={18} className="text-primary" />
        </div>
      ) : (
        <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
          Everyone is on a court — winners and losers return here after each game.
        </p>
      )}

      {restIds.length > 0 && (
        <div className="flex flex-col">
          {restIds.map((id, index) => {
            const player = playersById.get(id);
            if (!player) return null;
            return (
              <div
                key={id}
                className={cn(
                  'flex items-center gap-3 py-2',
                  index !== restIds.length - 1 && 'border-b border-border/60',
                )}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {index + 2}
                </span>
                <Avatar name={player.name} size={28} />
                <span className="flex-1 truncate font-medium">{player.name}</span>
                <Badge variant="outline">{gamesPlayed[id] ?? 0} games</Badge>
                <button
                  onClick={() => onRemove(id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={`Remove ${player.name} from the queue`}
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// Swap dialog — pick a queue player to replace someone on a court
// ============================================================================

function SwapDialog({
  target,
  candidates,
  gamesPlayed,
  onPick,
  onCancel,
}: {
  target: Player | null;
  candidates: Player[];
  gamesPlayed: Record<number, number>;
  onPick: (replacementId: number) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-foreground/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <Card
        className="flex w-full max-w-md flex-col gap-3 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-primary">
            <ArrowLeftRight size={14} />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-tight">
              Swap {target?.name ?? 'player'}
            </h3>
            <p className="text-xs leading-tight text-muted-foreground">
              Pick someone from the queue to take their spot. Fewest-played first.
            </p>
          </div>
        </div>

        {candidates.length > 0 ? (
          <div className="flex max-h-72 flex-col gap-1 overflow-auto">
            {candidates.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => onPick(player.id)}
                className="flex items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted"
              >
                <Avatar name={player.name} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</span>
                <Badge variant="outline">{gamesPlayed[player.id] ?? 0} games</Badge>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            Nobody is in the queue to swap with. Use “Clear” to free the whole court instead.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onCancel} variant="outline">
            Cancel
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// Setup view — pre-session check-in
// ============================================================================

function SetupView({
  players,
  selected,
  courts,
  duration,
  busy,
  error,
  onToggle,
  onSelectAll,
  onClear,
  onCourts,
  onDuration,
  onStart,
}: {
  players: Player[];
  selected: Set<number>;
  courts: number;
  duration: number | null;
  busy: boolean;
  error: string;
  onToggle: (id: number) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onCourts: (value: number) => void;
  onDuration: (value: number | null) => void;
  onStart: () => void;
}) {
  const selectedCount = players.filter((player) => selected.has(player.id)).length;

  return (
    <>
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/20 text-primary">
            <LayoutGrid size={12} />
          </span>
          Open Play
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Start a session</h1>
        <p className="text-sm text-muted-foreground">
          Check players in, set your courts and booked time, and Pikol rotates balanced 2v2s so everyone plays an
          equal number of games.
        </p>
      </div>

      {error && (
        <Card className="border-destructive p-4">
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Courts</span>
          <div className="flex items-center gap-2">
            <Button onClick={() => onCourts(courts - 1)} size="icon" variant="outline" disabled={courts <= 1}>
              <Minus size={16} />
            </Button>
            <span className="w-6 text-center text-lg font-bold tabular-nums">{courts}</span>
            <Button onClick={() => onCourts(courts + 1)} size="icon" variant="outline" disabled={courts >= MAX_COURTS}>
              <Plus size={16} />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Booked time</span>
          <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-muted p-1">
            {DURATION_OPTIONS.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => onDuration(option.value)}
                className={cn(
                  'min-h-9 rounded-md text-sm font-semibold text-muted-foreground transition-colors',
                  duration === option.value && 'bg-card text-foreground shadow-sm',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            We’ll show a countdown and stop starting new games {LAST_CALL_MINUTES} min before time’s up.
          </p>
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Check in players</h2>
          <div className="flex gap-2">
            <Button onClick={onSelectAll} size="sm" variant="ghost">
              All
            </Button>
            <Button onClick={onClear} size="sm" variant="ghost">
              None
            </Button>
          </div>
        </div>

        {players.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {players.map((player) => {
              const isOn = selected.has(player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => onToggle(player.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
                    isOn ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <Avatar name={player.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{player.name}</p>
                    <p className="text-xs text-muted-foreground">{player.mmr} MMR · {player.games} games</p>
                  </div>
                  <span
                    className={cn(
                      'grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold',
                      isOn ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
                    )}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Add players on the Players tab first, then come back to start open play.</p>
        )}

        {players.length > 0 && selectedCount < 4 && (
          <p className="text-sm text-muted-foreground">Select at least four players to start a session.</p>
        )}

        <Button onClick={onStart} disabled={selectedCount < 4 || busy} size="lg">
          {busy ? 'Starting…' : `Start session (${selectedCount} in)`}
        </Button>
      </Card>
    </>
  );
}
