import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeftRight,
  ChevronRight,
  Clock,
  Crown,
  Flame,
  LayoutGrid,
  Minus,
  Play,
  Plus,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react';

import { Avatar } from './Avatar';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { api } from '../lib/api';
import { formatDuration } from '../lib/game';
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
  endedAt: number | null;   // set when the game ends; scoring UI opens at this point
  score: Score;
};

// Lightweight per-session game log — drives the end-of-session recap entirely
// from local state (no extra API calls needed).
type SessionGame = {
  id: number;
  teamA: number[];
  teamB: number[];
  scoreA: number;
  scoreB: number;
  winner: TeamName;
  durationSeconds: number;
  playedAt: number;
};

type OpenPlaySession = {
  courtCount: number;
  checkedIn: number[];
  queue: number[];
  courts: Court[];
  gamesPlayed: Record<number, number>;
  startedAt: number;
  durationMinutes: number | null;
  // Snapshot each checked-in player's MMR when they joined the session, so the
  // recap can show "MMR mover of the night" without a server round-trip.
  mmrAtStart: Record<number, number>;
  // Every game recorded during this session — used to compute streak / pair /
  // closest-game / total court time stats in the recap.
  recordedGames: SessionGame[];
  // How many times each two-player partnership has happened this session,
  // keyed as "smallerId-largerId". Sent to the matchmaker so the next 2v2
  // split rotates through fresh partnerships before any pair repeats.
  sessionPairCounts: Record<string, number>;
};

function pairKey(a: number, b: number) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

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

// Trust whatever score the user enters in the End-game dialog, as long as the
// two scores aren't tied. Doesn't enforce "to 11, win by 2" — open play may
// use different formats and the user is explicitly entering a final score.
function getFinalWinner(score: Score): TeamName | null {
  if (score.teamA === score.teamB) return null;
  if (score.teamA === 0 && score.teamB === 0) return null;
  return score.teamA > score.teamB ? 'Team A' : 'Team B';
}

function loadStoredSession(): OpenPlaySession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenPlaySession>;
    if (!parsed || !Array.isArray(parsed.courts) || !Array.isArray(parsed.queue)) return null;
    // Backfill endedAt on any court loaded from older session data.
    const courts: Court[] = (parsed.courts ?? []).map((court) => ({
      ...court,
      endedAt: court.endedAt ?? null,
    }));
    return {
      courtCount: parsed.courtCount ?? 2,
      checkedIn: parsed.checkedIn ?? [],
      queue: parsed.queue ?? [],
      courts,
      gamesPlayed: parsed.gamesPlayed ?? {},
      startedAt: parsed.startedAt ?? Date.now(),
      durationMinutes: parsed.durationMinutes ?? null,
      mmrAtStart: parsed.mmrAtStart ?? {},
      recordedGames: parsed.recordedGames ?? [],
      sessionPairCounts: parsed.sessionPairCounts ?? {},
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
  const [showSummary, setShowSummary] = useState(false);

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

    const { courts, waiting } = await api.assignCourts(
      fairOrder(current),
      emptySlots,
      current.sessionPairCounts,
      current.gamesPlayed,
    );
    const seated: Court[] = courts.map((match) => ({
      id: makeId(),
      teamA: match.teamA.map((player) => player.id),
      teamB: match.teamB.map((player) => player.id),
      startedAt: null, // warming up
      endedAt: null,
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
      const mmrAtStart: Record<number, number> = {};
      for (const id of ids) {
        const player = playersById.get(id);
        if (player) mmrAtStart[id] = player.mmr;
      }
      const base: OpenPlaySession = {
        courtCount: setupCourts,
        checkedIn: ids,
        queue: ids,
        courts: [],
        gamesPlayed: {},
        startedAt: Date.now(),
        durationMinutes: setupDuration,
        mmrAtStart,
        recordedGames: [],
        sessionPairCounts: {},
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
              court.id === courtId && court.startedAt == null
                ? { ...court, startedAt: Date.now(), endedAt: null }
                : court,
            ),
          }
        : current,
    );
  }

  function endCourt(courtId: string) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.map((court) =>
              court.id === courtId && court.startedAt != null && court.endedAt == null
                ? { ...court, endedAt: Date.now() }
                : court,
            ),
          }
        : current,
    );
  }

  function resumeCourt(courtId: string) {
    setSession((current) =>
      current
        ? {
            ...current,
            courts: current.courts.map((court) =>
              court.id === courtId ? { ...court, endedAt: null } : court,
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
    // The scoring phase trusts the user's entered final score (any non-tied score).
    const winner = getFinalWinner(court.score) as TeamName | null;
    if (!winner || !session || court.startedAt == null) return;

    const teamA = resolve(court.teamA);
    const teamB = resolve(court.teamB);
    if (teamA.length < 2 || teamB.length < 2) return;

    // Duration freezes at endedAt if the user tapped End; otherwise compute live.
    const stopMs = court.endedAt ?? Date.now();
    const durationSeconds = Math.max(0, Math.floor((stopMs - court.startedAt) / 1000));

    setBusy(true);
    setError('');
    try {
      const result = await api.recordGame({
        match: { teamA, teamB },
        score: court.score,
        winner,
        durationSeconds,
        scoringEvents: [],
      });
      onResult(result.players, result.game);

      // Count this game for all four players, rotate them, then refill.
      const played = [...court.teamA, ...court.teamB];
      const gamesPlayed = { ...session.gamesPlayed };
      for (const id of played) gamesPlayed[id] = (gamesPlayed[id] ?? 0) + 1;

      const sessionGame: SessionGame = {
        id: result.game.id,
        teamA: [...court.teamA],
        teamB: [...court.teamB],
        scoreA: court.score.teamA,
        scoreB: court.score.teamB,
        winner,
        durationSeconds,
        playedAt: result.game.playedAt,
      };

      // Bump pair counters for the two partnerships that just finished playing.
      const sessionPairCounts = { ...session.sessionPairCounts };
      const bump = (a: number | undefined, b: number | undefined) => {
        if (a == null || b == null) return;
        const key = pairKey(a, b);
        sessionPairCounts[key] = (sessionPairCounts[key] ?? 0) + 1;
      };
      bump(court.teamA[0], court.teamA[1]);
      bump(court.teamB[0], court.teamB[1]);

      const afterRecord: OpenPlaySession = {
        ...session,
        gamesPlayed,
        recordedGames: [...session.recordedGames, sessionGame],
        sessionPairCounts,
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
    setSession((current) => {
      if (!current || current.checkedIn.includes(playerId)) return current;
      const player = playersById.get(playerId);
      return {
        ...current,
        checkedIn: [...current.checkedIn, playerId],
        queue: [...current.queue, playerId],
        // Snapshot the late-joiner's MMR so their recap delta is accurate.
        mmrAtStart:
          current.mmrAtStart[playerId] != null
            ? current.mmrAtStart
            : { ...current.mmrAtStart, [playerId]: player?.mmr ?? 1000 },
      };
    });
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
    // If at least one game was recorded, show the celebratory recap first.
    if (session && session.recordedGames.length > 0) {
      setShowSummary(true);
      return;
    }
    setSession(null);
    setError('');
  }

  function confirmEndSession() {
    setShowSummary(false);
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

  // First court with endedAt set is the one whose score we're entering right now.
  // Persisting endedAt across reloads means the dialog re-opens if the page is refreshed.
  const endingCourt = session.courts.find((court) => court.endedAt != null) ?? null;
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
            elapsed={
              court.startedAt != null
                ? Math.max(0, Math.floor(((court.endedAt ?? now) - court.startedAt) / 1000))
                : 0
            }
            onStart={() => startCourt(court.id)}
            onEnd={() => endCourt(court.id)}
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

      {showSummary && (
        <SessionSummaryDialog
          session={session}
          playersById={playersById}
          onConfirm={confirmEndSession}
          onCancel={() => setShowSummary(false)}
        />
      )}

      {endingCourt && (
        <EndGameDialog
          court={endingCourt}
          teamA={resolve(endingCourt.teamA)}
          teamB={resolve(endingCourt.teamB)}
          busy={busy}
          onSetScore={setScore}
          onRecord={() => void recordCourt(endingCourt)}
          onCancel={() => resumeCourt(endingCourt.id)}
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
  onStart,
  onEnd,
  onClear,
  onSwap,
}: {
  index: number;
  court: Court;
  teamA: Player[];
  teamB: Player[];
  elapsed: number;
  onStart: () => void;
  onEnd: () => void;
  onClear: () => void;
  onSwap: (playerId: number) => void;
}) {
  const started = court.startedAt != null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-primary">
            <LayoutGrid size={16} />
          </span>
          <span className="font-extrabold tracking-tight">Court {index}</span>
          {started ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
              Warming up
            </span>
          )}
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
        <CourtSide team="Team A" players={teamA} onSwap={onSwap} />
        <div className="-mx-px border-l border-dashed border-border" />
        <CourtSide team="Team B" players={teamB} onSwap={onSwap} rightSide />
      </div>

      <div className="flex gap-2">
        <Button onClick={onClear} variant="ghost" size="sm" className="flex-1">
          Clear
        </Button>
        {started ? (
          <Button onClick={onEnd} variant="secondary" size="sm" className="flex-1">
            End game
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

// One side of a court: team label + the two players (tap to swap with the queue).
// Score lives in the EndGameDialog now, not here.
function CourtSide({
  team,
  players,
  onSwap,
  rightSide,
}: {
  team: string;
  players: Player[];
  onSwap: (playerId: number) => void;
  rightSide?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-md p-3', rightSide ? 'pl-4' : 'pr-4')}>
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{team}</span>

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
    </div>
  );
}

// ============================================================================
// End game dialog — appears when a court's `endedAt` is set; user enters final
// score then taps Record. Canceling resumes the court.
// ============================================================================

function EndGameDialog({
  court,
  teamA,
  teamB,
  busy,
  onSetScore,
  onRecord,
  onCancel,
}: {
  court: Court;
  teamA: Player[];
  teamB: Player[];
  busy: boolean;
  onSetScore: (courtId: string, team: 'teamA' | 'teamB', value: number) => void;
  onRecord: () => void;
  onCancel: () => void;
}) {
  const winner = getFinalWinner(court.score);
  const tied = court.score.teamA === court.score.teamB && court.score.teamA > 0;

  return (
    <div
      className="fixed inset-0 z-20 grid place-items-center bg-foreground/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <Card
        className="flex w-full max-w-md flex-col gap-4 p-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-success/20 text-success">
            <Trophy size={16} />
          </span>
          <div>
            <h3 className="text-base font-bold leading-tight">Game over — enter the final score</h3>
            <p className="text-xs leading-tight text-muted-foreground">
              Tap a number to edit. Record updates MMR &amp; history.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <ScoreRow
            team="Team A"
            players={teamA}
            score={court.score.teamA}
            isWinner={winner === 'Team A'}
            onSet={(value) => onSetScore(court.id, 'teamA', value)}
            autoFocus
          />
          <ScoreRow
            team="Team B"
            players={teamB}
            score={court.score.teamB}
            isWinner={winner === 'Team B'}
            onSet={(value) => onSetScore(court.id, 'teamB', value)}
          />
        </div>

        {tied && (
          <p className="text-xs text-warning">Scores are tied — pickleball can't end on a tie.</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onCancel} variant="outline">
            Resume game
          </Button>
          <Button
            onClick={onRecord}
            disabled={!winner || busy}
            variant="success"
          >
            <Trophy size={14} /> Record game
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ScoreRow({
  team,
  players,
  score,
  isWinner,
  autoFocus,
  onSet,
}: {
  team: string;
  players: Player[];
  score: number;
  isWinner: boolean;
  autoFocus?: boolean;
  onSet: (value: number) => void;
}) {
  const names = players.map((p) => p.name).join(' & ') || '—';
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border border-border p-3 transition-colors',
        isWinner && 'border-success/40 bg-success/10',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{team}</p>
        <p className="truncate text-sm font-semibold">{names}</p>
      </div>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={score}
        autoFocus={autoFocus}
        onFocus={(event) => event.target.select()}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, '').slice(0, 2);
          onSet(digits === '' ? 0 : parseInt(digits, 10));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        aria-label={`${team} score`}
        className={cn(
          'w-20 rounded-md border border-border bg-card text-center text-4xl font-black tabular-nums leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary',
          isWinner ? 'text-success' : 'text-foreground',
        )}
      />
    </div>
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
// Session recap — celebratory end-of-session summary
// ============================================================================

function formatHoursMinutes(totalSeconds: number) {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

type RecapTone = 'primary' | 'success' | 'warning' | 'destructive';

function RecapTile({
  icon,
  tone,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  tone: RecapTone;
  label: string;
  value: string;
  detail: string;
}) {
  const borderTone = {
    primary: 'border-l-primary',
    success: 'border-l-success',
    warning: 'border-l-warning',
    destructive: 'border-l-destructive',
  }[tone];
  const iconTone = {
    primary: 'bg-primary/20 text-primary',
    success: 'bg-success/20 text-success',
    warning: 'bg-warning/20 text-warning',
    destructive: 'bg-destructive/20 text-destructive',
  }[tone];

  return (
    <div className={cn('flex flex-col gap-1 rounded-lg border border-border border-l-4 bg-background p-3', borderTone)}>
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className={cn('grid h-5 w-5 place-items-center rounded-md', iconTone)}>{icon}</span>
        {label}
      </div>
      <p className="truncate text-base font-bold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function SessionSummaryDialog({
  session,
  playersById,
  onConfirm,
  onCancel,
}: {
  session: OpenPlaySession;
  playersById: Map<number, Player>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Stable name lookup — falls back to a placeholder for deleted players.
  const nameOf = (id: number) => playersById.get(id)?.name ?? 'Unknown';

  const gamesCount = session.recordedGames.length;
  const playersCount = session.checkedIn.filter((id) => playersById.has(id)).length;
  const totalSeconds = session.recordedGames.reduce((sum, g) => sum + g.durationSeconds, 0);

  // ── MVP: biggest MMR mover (positive delta) among players who actually played.
  const mmrChanges = session.checkedIn
    .filter((id) => (session.gamesPlayed[id] ?? 0) > 0)
    .map((id) => {
      const player = playersById.get(id);
      const start = session.mmrAtStart[id];
      if (!player || start == null) return null;
      return { id, name: player.name, delta: player.mmr - start };
    })
    .filter((entry): entry is { id: number; name: string; delta: number } => Boolean(entry));
  const mvp = mmrChanges.length > 0 ? [...mmrChanges].sort((a, b) => b.delta - a.delta)[0] : null;

  // ── Most games played this session.
  const mostGames = Object.entries(session.gamesPlayed)
    .map(([id, count]) => ({ id: Number(id), count }))
    .filter((entry) => entry.count > 0 && playersById.has(entry.id))
    .sort((a, b) => b.count - a.count)[0];

  // ── Longest win streak this session (consecutive wins across the games array).
  const streakState = new Map<number, { current: number; max: number }>();
  for (const game of session.recordedGames) {
    const winners = new Set(game.winner === 'Team A' ? game.teamA : game.teamB);
    const losers = new Set(game.winner === 'Team A' ? game.teamB : game.teamA);
    for (const id of [...winners, ...losers]) {
      const entry = streakState.get(id) ?? { current: 0, max: 0 };
      if (winners.has(id)) {
        entry.current += 1;
        if (entry.current > entry.max) entry.max = entry.current;
      } else {
        entry.current = 0;
      }
      streakState.set(id, entry);
    }
  }
  let longestStreak: { id: number; name: string; max: number } | null = null;
  for (const [id, entry] of streakState) {
    if (!playersById.has(id)) continue;
    if (!longestStreak || entry.max > longestStreak.max) {
      longestStreak = { id, name: nameOf(id), max: entry.max };
    }
  }

  // ── Most-winning pair this session.
  const pairWins = new Map<string, { a: number; b: number; wins: number }>();
  for (const game of session.recordedGames) {
    const winningTeam = game.winner === 'Team A' ? game.teamA : game.teamB;
    if (winningTeam.length < 2) continue;
    const [a, b] = [...winningTeam].sort((x, y) => x - y);
    const key = `${a}-${b}`;
    const existing = pairWins.get(key) ?? { a, b, wins: 0 };
    existing.wins += 1;
    pairWins.set(key, existing);
  }
  const bestPair = [...pairWins.values()].sort((a, b) => b.wins - a.wins)[0];

  // ── Closest game (smallest score margin).
  const closestGame =
    session.recordedGames.length > 0
      ? [...session.recordedGames].sort(
          (a, b) => Math.abs(a.scoreA - a.scoreB) - Math.abs(b.scoreA - b.scoreB),
        )[0]
      : null;

  const recapDate = new Date(session.startedAt).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-foreground/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
    >
      <Card
        className="relative flex w-full max-w-lg flex-col gap-4 overflow-hidden p-5"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Subtle accent glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/20 opacity-60 blur-3xl"
        />

        <div className="relative flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/20 text-primary">
              <Sparkles size={18} />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                Pikol · Session recap
              </p>
              <h2 className="text-xl font-extrabold leading-tight">Great session!</h2>
              <p className="text-sm text-muted-foreground">
                {recapDate} · {gamesCount} {gamesCount === 1 ? 'game' : 'games'} · {playersCount}{' '}
                {playersCount === 1 ? 'player' : 'players'} · {formatHoursMinutes(totalSeconds)}
              </p>
            </div>
          </div>
        </div>

        <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
          {mvp && (
            <RecapTile
              icon={<Crown size={14} />}
              tone="primary"
              label="MVP"
              value={mvp.name}
              detail={`${mvp.delta >= 0 ? '+' : ''}${mvp.delta} MMR`}
            />
          )}
          {mostGames && (
            <RecapTile
              icon={<Flame size={14} />}
              tone="warning"
              label="Most games"
              value={nameOf(mostGames.id)}
              detail={`${mostGames.count} games played`}
            />
          )}
          {longestStreak && longestStreak.max >= 2 && (
            <RecapTile
              icon={<Zap size={14} />}
              tone="warning"
              label="Best streak"
              value={longestStreak.name}
              detail={`${longestStreak.max} wins in a row`}
            />
          )}
          {bestPair && bestPair.wins >= 1 && (
            <RecapTile
              icon={<Users size={14} />}
              tone="success"
              label="Best pair"
              value={`${nameOf(bestPair.a)} & ${nameOf(bestPair.b)}`}
              detail={`${bestPair.wins} ${bestPair.wins === 1 ? 'win' : 'wins'} together`}
            />
          )}
          {closestGame && (
            <RecapTile
              icon={<Target size={14} />}
              tone="primary"
              label="Closest game"
              value={`${closestGame.scoreA}–${closestGame.scoreB}`}
              detail={`${closestGame.winner} won by ${Math.abs(closestGame.scoreA - closestGame.scoreB)}`}
            />
          )}
          <RecapTile
            icon={<Clock size={14} />}
            tone="primary"
            label="Court time"
            value={formatHoursMinutes(totalSeconds)}
            detail={`${gamesCount} ${gamesCount === 1 ? 'game' : 'games'} recorded`}
          />
        </div>

        <p className="relative text-center text-xs text-muted-foreground">
          📸 Screenshot this card to share with the group.
        </p>

        <div className="relative flex justify-end gap-2">
          <Button onClick={onCancel} variant="outline">
            Keep playing
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            End session
          </Button>
        </div>
      </Card>
    </div>
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
