import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  BarChart3,
  Clock,
  Crown,
  Flame,
  History,
  Hourglass,
  LayoutGrid,
  Moon,
  Rewind,
  Sun,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';

import { Avatar } from './components/Avatar';
import { OpenPlayPage } from './components/OpenPlayPage';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { api } from './lib/api';
import {
  formatDuration,
  getMatchPoint,
  getWinner,
  winRate,
} from './lib/game';
import {
  bestComeback,
  bestPairings,
  biggestLead,
  biggestUpset,
  closestGame,
  gameLabel,
  gameScore,
  longestGame,
  longestWinStreaks,
  underdogMargin,
} from './lib/insights';
import { cn } from './lib/utils';
import type { GameHistoryItem, Match, Player, Score, ScoringEvent, TeamName } from './lib/types';

type Page = 'game' | 'openplay' | 'players' | 'history' | 'insights';
type HistoryView = 'games' | 'pairs' | 'players';
type DialogState = 'record' | 'discard' | null;
type PendingAction = 'add-player' | 'reset' | 'pick-teams' | 'record-match' | `availability-${number}` | null;

const emptyScore: Score = { teamA: 0, teamB: 0 };

export default function App() {
  const [page, setPage] = useState<Page>('game');
  const [players, setPlayers] = useState<Player[]>([]);
  const [history, setHistory] = useState<GameHistoryItem[]>([]);
  const [match, setMatch] = useState<Match | null>(null);
  const [score, setScore] = useState<Score>(emptyScore);
  const [events, setEvents] = useState<ScoringEvent[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [apiError, setApiError] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [playerNameError, setPlayerNameError] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [historyView, setHistoryView] = useState<HistoryView>('games');
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const winner = getWinner(score);
  const matchPoint = getMatchPoint(score);
  const timerRunning = startedAt !== null;
  const canCreateMatch = players.length >= 4;
  const isAddingPlayer = pendingAction === 'add-player';
  const isResetting = pendingAction === 'reset';
  const isPickingTeams = pendingAction === 'pick-teams';
  const isRecordingMatch = pendingAction === 'record-match';
  const availablePlayerCount = players.filter((player) => player.available).length;

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f131a' : '#f7f8fb');
    try {
      localStorage.setItem('pikol-theme', theme);
    } catch {
      // ignore unavailable storage (e.g. private mode)
    }
  }, [theme]);

  useEffect(() => {
    if (!startedAt) return;

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  useEffect(() => {
    if (winner) setStartedAt(null);
  }, [winner]);

  const rankedPlayers = useMemo(
    () =>
      [...players].sort((a, b) => {
        const aWinRate = a.games > 0 ? a.wins / a.games : 0;
        const bWinRate = b.games > 0 ? b.wins / b.games : 0;

        return (
          b.mmr - a.mmr ||
          b.wins - a.wins ||
          bWinRate - aWinRate ||
          b.games - a.games ||
          a.name.localeCompare(b.name)
        );
      }),
    [players],
  );
  const pairStats = useMemo(() => bestPairings(history), [history]);
  const streaks = useMemo(() => longestWinStreaks(history), [history]);
  const selectedPlayerGames = useMemo(() => {
    if (!selectedPlayerId) return [];
    return [...history]
      .reverse()
      .filter((game) => [...game.teamA, ...game.teamB].some((player) => player.id === selectedPlayerId));
  }, [history, selectedPlayerId]);

  async function loadInitialData() {
    setIsLoading(true);
    setApiError('');

    try {
      const [loadedPlayers, loadedHistory, loadedMatch] = await Promise.all([
        api.getPlayers(),
        api.getHistory(),
        api.getCurrentMatch(),
      ]);

      setPlayers(loadedPlayers);
      setHistory(loadedHistory);
      setMatch(loadedMatch);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to connect to the API.');
    } finally {
      setIsLoading(false);
    }
  }

  function resetCurrentGame() {
    setScore(emptyScore);
    setEvents([]);
    setElapsedSeconds(0);
    setStartedAt(null);
    setHasStarted(false);
  }

  async function pickTeams() {
    if (availablePlayerCount < 4 || isRandomizing || isPickingTeams) return;

    setMatch(null);
    resetCurrentGame();
    setIsRandomizing(true);
    setPendingAction('pick-teams');

    try {
      await wait(550);
      setMatch(await api.pickMatch());
      setApiError('');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to pick teams.');
    } finally {
      setIsRandomizing(false);
      setPendingAction(null);
    }
  }

  function toggleTimer() {
    if (!match || winner) return;

    if (timerRunning) {
      setStartedAt(null);
      return;
    }

    setHasStarted(true);
    setStartedAt(Date.now() - elapsedSeconds * 1000);
  }

  function addPoint(team: TeamName) {
    if (!match || !hasStarted || winner) return;

    const nextScore = {
      teamA: score.teamA + (team === 'Team A' ? 1 : 0),
      teamB: score.teamB + (team === 'Team B' ? 1 : 0),
    };

    setScore(nextScore);
    setEvents((currentEvents) => [...currentEvents, { team, score: nextScore, elapsedSeconds }]);
    if (getWinner(nextScore)) setStartedAt(null);
  }

  function subtractPoint(team: TeamName) {
    if (!match || !hasStarted) return;
    const canSubtract = team === 'Team A' ? score.teamA > 0 : score.teamB > 0;
    if (!canSubtract) return;

    const hadWinner = Boolean(winner);
    const nextScore = {
      teamA: Math.max(0, score.teamA - (team === 'Team A' ? 1 : 0)),
      teamB: Math.max(0, score.teamB - (team === 'Team B' ? 1 : 0)),
    };

    setScore(nextScore);
    setEvents((currentEvents) => {
      const indexToRemove = [...currentEvents].map((event) => event.team).lastIndexOf(team);
      return indexToRemove < 0 ? currentEvents : currentEvents.filter((_, index) => index !== indexToRemove);
    });

    if (hadWinner && !getWinner(nextScore)) setStartedAt(Date.now() - elapsedSeconds * 1000);
  }

  async function addPlayer() {
    const name = newPlayerName.trim();

    if (!name) {
      setPlayerNameError('Enter a player name first.');
      return;
    }

    if (players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      setPlayerNameError('That player is already in the list.');
      return;
    }

    try {
      setPendingAction('add-player');
      await api.addPlayer(name);
      setPlayers(await api.getPlayers());
      setNewPlayerName('');
      setPlayerNameError('');
      setApiError('');
    } catch (error) {
      setPlayerNameError(error instanceof Error ? error.message : 'Unable to add player.');
    } finally {
      setPendingAction(null);
    }
  }

  async function resetForTesting() {
    try {
      setPendingAction('reset');
      const resetData = await api.reset();
      setPlayers(resetData.players);
      setHistory(resetData.history);
      setMatch(resetData.currentMatch);
      resetCurrentGame();
      setSelectedPlayerId(null);
      setApiError('');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to reset data.');
    } finally {
      setPendingAction(null);
    }
  }

  async function updatePlayerAvailability(playerId: number, available: boolean) {
    try {
      setPendingAction(`availability-${playerId}`);
      const updatedPlayer = await api.updatePlayerAvailability(playerId, available);
      setPlayers((currentPlayers) =>
        currentPlayers.map((player) => (player.id === updatedPlayer.id ? updatedPlayer : player)),
      );
      setApiError('');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to update player availability.');
    } finally {
      setPendingAction(null);
    }
  }

  async function recordMatch() {
    if (!match || !winner) return;

    try {
      setPendingAction('record-match');
      const result = await api.recordGame({
        match,
        score,
        winner,
        durationSeconds: elapsedSeconds,
        scoringEvents: events,
      });

      setPlayers(result.players);
      setHistory((currentHistory) => [result.game, ...currentHistory]);
      setDialog(null);
      setMatch(null);
      resetCurrentGame();
      setApiError('');
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to record match.');
      setDialog(null);
    } finally {
      setPendingAction(null);
    }
  }

  function discardMatch() {
    setDialog(null);
    resetCurrentGame();
  }

  function handleOpenPlayResult(updatedPlayers: Player[], game: GameHistoryItem) {
    setPlayers(updatedPlayers);
    setHistory((current) => [game, ...current]);
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/pickleball.png" alt="" className="h-8 w-8 rounded-lg" />
            <div className="leading-tight">
              <p className="text-base font-extrabold tracking-tight">Pikol</p>
              <p className="text-xs text-muted-foreground">2v2 open play</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold capitalize text-muted-foreground">
              {page}
            </span>
            <button
              type="button"
              onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-5">
        {apiError && (
          <Card className="border-destructive p-4">
            <p className="font-semibold text-destructive">API error</p>
            <p className="text-sm text-muted-foreground">{apiError}</p>
          </Card>
        )}
        {isLoading && (
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Loading data from API...</p>
          </Card>
        )}
        {page === 'game' && (
          <GamePage
            canCreateMatch={canCreateMatch}
            availablePlayerCount={availablePlayerCount}
            elapsedSeconds={elapsedSeconds}
            events={events}
            hasStarted={hasStarted}
            isRandomizing={isRandomizing}
            isPickingTeams={isPickingTeams}
            match={match}
            matchPoint={matchPoint}
            onAddPoint={addPoint}
            onOpenDialog={setDialog}
            onPickTeams={() => void pickTeams()}
            onSubtractPoint={subtractPoint}
            onToggleTimer={toggleTimer}
            score={score}
            timerRunning={timerRunning}
            winner={winner}
          />
        )}
        {page === 'openplay' && <OpenPlayPage players={players} onResult={handleOpenPlayResult} />}
        {page === 'players' && (
          <PlayersPage
            newPlayerName={newPlayerName}
            isAddingPlayer={isAddingPlayer}
            isResetting={isResetting}
            onAddPlayer={() => void addPlayer()}
            onNameChange={setNewPlayerName}
            onReset={() => void resetForTesting()}
            onUpdateAvailability={(playerId, available) => void updatePlayerAvailability(playerId, available)}
            playerNameError={playerNameError}
            pendingAction={pendingAction}
            players={rankedPlayers}
          />
        )}
        {page === 'history' && (
          <HistoryPage
            history={history}
            historyView={historyView}
            onSelectPlayer={setSelectedPlayerId}
            onViewChange={setHistoryView}
            pairStats={pairStats}
            players={rankedPlayers}
            selectedPlayerGames={selectedPlayerGames}
            selectedPlayerId={selectedPlayerId}
          />
        )}
        {page === 'insights' && <InsightsPage history={history} pairStats={pairStats} players={rankedPlayers} streaks={streaks} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <NavButton active={page === 'game'} icon={<Trophy size={20} />} label="Game" onClick={() => setPage('game')} />
          <NavButton active={page === 'openplay'} icon={<LayoutGrid size={20} />} label="Open Play" onClick={() => setPage('openplay')} />
          <NavButton active={page === 'players'} icon={<Users size={20} />} label="Players" onClick={() => setPage('players')} />
          <NavButton active={page === 'history'} icon={<History size={20} />} label="History" onClick={() => setPage('history')} />
          <NavButton active={page === 'insights'} icon={<BarChart3 size={20} />} label="Insights" onClick={() => setPage('insights')} />
        </div>
      </nav>

      {dialog === 'record' && (
        <ConfirmDialog
          actionLabel="Record"
          description="This will add one game to all four players, add one win to the winning team, update MMR, and save this game to History."
          isLoading={isRecordingMatch}
          onCancel={() => setDialog(null)}
          onConfirm={() => void recordMatch()}
          title="Record this match?"
          variant="success"
        />
      )}
      {dialog === 'discard' && (
        <ConfirmDialog
          actionLabel="Do Not Record"
          description="This will reset the score and timer without adding games, wins, or history. The same teams stay on screen."
          onCancel={() => setDialog(null)}
          onConfirm={discardMatch}
          title="Do not record this match?"
          variant="destructive"
        />
      )}
    </div>
  );
}

function GamePage({
  availablePlayerCount,
  canCreateMatch,
  elapsedSeconds,
  events,
  hasStarted,
  isRandomizing,
  isPickingTeams,
  match,
  matchPoint,
  onAddPoint,
  onOpenDialog,
  onPickTeams,
  onSubtractPoint,
  onToggleTimer,
  score,
  timerRunning,
  winner,
}: {
  availablePlayerCount: number;
  canCreateMatch: boolean;
  elapsedSeconds: number;
  events: ScoringEvent[];
  hasStarted: boolean;
  isRandomizing: boolean;
  isPickingTeams: boolean;
  match: Match | null;
  matchPoint: TeamName | 'Deuce' | null;
  onAddPoint: (team: TeamName) => void;
  onOpenDialog: (dialog: DialogState) => void;
  onPickTeams: () => void;
  onSubtractPoint: (team: TeamName) => void;
  onToggleTimer: () => void;
  score: Score;
  timerRunning: boolean;
  winner: TeamName | null;
}) {
  return (
    <>
      <PageHeader title="Game" description="Pick balanced 2v2 teams, run the timer, score to 11, and record the result." />

      <Panel>
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">Next match</h2>
          <p className="text-sm text-muted-foreground">Rotates teammate pairs first, then balances teams by MMR.</p>
        </div>

        {match ? (
          <div className={cn('grid gap-2 md:grid-cols-2', isRandomizing && 'animate-pulse opacity-60')}>
            <MatchTeamCard
              name="Team A"
              onAdd={() => onAddPoint('Team A')}
              onSubtract={() => onSubtractPoint('Team A')}
              players={match.teamA}
              score={score.teamA}
              showScore={hasStarted}
              winner={winner}
            />
            <MatchTeamCard
              name="Team B"
              onAdd={() => onAddPoint('Team B')}
              onSubtract={() => onSubtractPoint('Team B')}
              players={match.teamB}
              score={score.teamB}
              showScore={hasStarted}
              winner={winner}
            />
          </div>
        ) : isRandomizing ? (
          <div className="animate-pulse rounded-md bg-muted p-4">
            <p className="text-xl font-semibold">Picking teams...</p>
            <p className="text-sm text-muted-foreground">Balancing players with fewer recorded games first.</p>
          </div>
        ) : availablePlayerCount >= 4 ? (
          <p className="text-sm text-muted-foreground">Tap Pick Teams when you are ready to generate a 2v2 match.</p>
        ) : canCreateMatch ? (
          <p className="text-sm text-muted-foreground">Mark at least four players available to generate a 2v2 match.</p>
        ) : (
          <p className="text-sm text-muted-foreground">Add four players to generate the first 2v2 match.</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusBox label="Timer" value={formatDuration(elapsedSeconds)} />
          {winner && <StatusBox label="Winner" value={winner} valueClassName="text-success" />}
          {!winner && matchPoint && (
            <StatusBox
              label={matchPoint === 'Deuce' ? 'Status' : 'Match point'}
              value={matchPoint}
              valueClassName="text-warning"
            />
          )}

          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {!match && (
              <Button disabled={availablePlayerCount < 4 || isRandomizing || isPickingTeams} onClick={onPickTeams}>
                {isPickingTeams || isRandomizing ? 'Picking...' : 'Pick Teams'}
              </Button>
            )}
            {match && !hasStarted && (
              <Button disabled={availablePlayerCount < 4 || isRandomizing || isPickingTeams} onClick={onPickTeams}>
                {isPickingTeams || isRandomizing ? 'Picking...' : 'Repick Teams'}
              </Button>
            )}
            {winner ? (
              <Button disabled={isRandomizing} onClick={() => onOpenDialog('discard')} variant="destructive">
                Do Not Record
              </Button>
            ) : (
              <Button disabled={!match || isRandomizing} onClick={onToggleTimer} variant={timerRunning ? 'secondary' : 'warning'}>
                {timerRunning ? 'Stop Time' : 'Start Time'}
              </Button>
            )}
            {winner && (
              <Button disabled={isRandomizing} onClick={() => onOpenDialog('record')} variant="secondary">
                Record
              </Button>
            )}
          </div>
        </div>

        {match && <p className="text-xs text-muted-foreground">{events.length} scoring events recorded for this game.</p>}
      </Panel>
    </>
  );
}

function MatchTeamCard({
  name,
  onAdd,
  onSubtract,
  players,
  score,
  showScore,
  winner,
}: {
  name: TeamName;
  onAdd: () => void;
  onSubtract: () => void;
  players: Player[];
  score: number;
  showScore: boolean;
  winner: TeamName | null;
}) {
  return (
    <div className={cn('space-y-3 rounded-md bg-background p-4', winner === name && 'ring-2 ring-success')}>
      <p className="text-sm text-muted-foreground">{name}</p>
      {players.map((player) => (
        <div key={player.id}>
          <p className="text-xl font-semibold">{player.name}</p>
          <p className="text-sm text-muted-foreground">
            {player.mmr} MMR - {player.games} games
          </p>
        </div>
      ))}

      {showScore ? (
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="w-24 shrink-0 text-6xl font-black leading-none">{score}</div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <Button disabled={score === 0} onClick={onSubtract} variant="destructive">
              -1
            </Button>
            <Button disabled={Boolean(winner)} onClick={onAdd} variant="success">
              +1
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Start time to score.</p>
      )}
    </div>
  );
}

function PlayersPage({
  isAddingPlayer,
  isResetting,
  newPlayerName,
  onAddPlayer,
  onNameChange,
  onReset,
  onUpdateAvailability,
  playerNameError,
  pendingAction,
  players,
}: {
  isAddingPlayer: boolean;
  isResetting: boolean;
  newPlayerName: string;
  onAddPlayer: () => void;
  onNameChange: (name: string) => void;
  onReset: () => void;
  onUpdateAvailability: (playerId: number, available: boolean) => void;
  playerNameError: string;
  pendingAction: PendingAction;
  players: Player[];
}) {
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Players" description="Add players and track MMR, wins, games, and win rate." />
        <Button disabled={isResetting || isAddingPlayer} onClick={onReset} variant="secondary">
          {isResetting ? 'Resetting...' : 'Reset'}
        </Button>
      </div>

      <Panel>
        <div>
          <h2 className="text-2xl font-semibold tracking-normal">Add players</h2>
          <p className="text-sm text-muted-foreground">Add at least four players before starting a 2v2 game.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <Input
            disabled={isAddingPlayer || isResetting}
            onChange={(event) => onNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAddPlayer();
            }}
            placeholder="Player name"
            value={newPlayerName}
          />
          <Button disabled={isAddingPlayer || isResetting} onClick={onAddPlayer}>
            {isAddingPlayer ? 'Adding...' : 'Add'}
          </Button>
        </div>
        {playerNameError && <p className="text-sm text-destructive">{playerNameError}</p>}
      </Panel>

      <Panel>
        <h2 className="text-2xl font-semibold tracking-normal">Rankings</h2>
        <div className="grid min-h-10 grid-cols-[28px_1fr_44px_44px_44px_92px] items-center gap-2 px-3 text-sm font-semibold">
          <span className="text-center">#</span>
          <span>Player</span>
          <span className="text-right">MMR</span>
          <span className="text-right">W</span>
          <span className="text-right">G</span>
          <span className="text-right">Status</span>
        </div>
        {players.length > 0 ? (
          players.map((player, index) => (
            <div
              key={player.id}
              className={cn(
                'grid min-h-14 grid-cols-[28px_1fr_44px_44px_44px_92px] items-center gap-2 rounded-md bg-background px-3',
                !player.available && 'opacity-60',
              )}
            >
              <span className="text-center text-sm font-semibold">{index + 1}</span>
              <div>
                <p>{player.name}</p>
                <p className="text-sm text-muted-foreground">{winRate(player.wins, player.games)}% win rate</p>
              </div>
              <span className="text-right text-sm font-semibold">{player.mmr}</span>
              <span className="text-right text-sm font-semibold">{player.wins}</span>
              <span className="text-right text-sm text-muted-foreground">{player.games}</span>
              <Button
                disabled={pendingAction === `availability-${player.id}` || isResetting}
                onClick={() => onUpdateAvailability(player.id, !player.available)}
                size="sm"
                variant={player.available ? 'success' : 'outline'}
              >
                {pendingAction === `availability-${player.id}` ? 'Saving...' : player.available ? 'Available' : 'Away'}
              </Button>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Add players here and record games on the Game tab to build rankings.</p>
        )}
      </Panel>
    </>
  );
}

function HistoryPage({
  history,
  historyView,
  onSelectPlayer,
  onViewChange,
  pairStats,
  players,
  selectedPlayerGames,
  selectedPlayerId,
}: {
  history: GameHistoryItem[];
  historyView: HistoryView;
  onSelectPlayer: (id: number) => void;
  onViewChange: (view: HistoryView) => void;
  pairStats: ReturnType<typeof bestPairings>;
  players: Player[];
  selectedPlayerGames: GameHistoryItem[];
  selectedPlayerId: number | null;
}) {
  return (
    <>
      <PageHeader title="History" description="Review games, player records, and pair performance." />

      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1">
        {(['games', 'pairs', 'players'] as const).map((view) => (
          <button
            className={cn(
              'min-h-10 rounded-md text-sm font-semibold capitalize text-muted-foreground transition-colors',
              historyView === view && 'bg-card text-foreground shadow-sm',
            )}
            key={view}
            onClick={() => onViewChange(view)}
            type="button"
          >
            {view}
          </button>
        ))}
      </div>

      {historyView === 'games' &&
        (history.length > 0 ? (
          history.map((game, index) => <GameHistoryCard game={game} index={history.length - index} key={game.id} />)
        ) : (
          <EmptyCard text="Recorded games will appear here after you finish a match on the Game tab." />
        ))}

      {historyView === 'pairs' &&
        (pairStats.length > 0 ? (
          <Panel>
            <div>
              <h2 className="text-lg font-semibold">Pair performance</h2>
              <p className="text-sm text-muted-foreground">Pairs ranked by their win rate together.</p>
            </div>
            <div className="flex flex-col">
              {pairStats.map((pair, index) => {
                const [name1 = '?', name2 = '?'] = pair.names.split(' / ');
                const rate = winRate(pair.wins, pair.games);
                return (
                  <div
                    key={pair.key}
                    className={cn(
                      'flex items-center gap-3 py-2.5',
                      index !== pairStats.length - 1 && 'border-b border-border/60',
                    )}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                      {index + 1}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <Avatar name={name1} size={28} />
                      <Avatar name={name2} size={28} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{pair.names}</p>
                      <p className="text-xs text-muted-foreground">
                        {pair.wins}W · {pair.games - pair.wins}L · {pair.games}G together
                      </p>
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'text-2xl font-black tabular-nums leading-none',
                          rate >= 60 && 'text-success',
                          rate < 40 && pair.games >= 3 && 'text-destructive',
                        )}
                      >
                        {rate}%
                      </p>
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">win rate</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        ) : (
          <EmptyCard text="Pair history appears after games are recorded." />
        ))}

      {historyView === 'players' &&
        (players.length > 0 ? (
          <>
            <Panel>
              <div>
                <h2 className="text-lg font-semibold">Player history</h2>
                <p className="text-sm text-muted-foreground">Pick a player to see their chronological games.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {players.map((player) => {
                  const selected = selectedPlayerId === player.id;
                  return (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => onSelectPlayer(player.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 text-sm font-medium transition-colors',
                        selected
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card hover:bg-muted',
                      )}
                    >
                      <Avatar name={player.name} size={24} />
                      <span>{player.name}</span>
                    </button>
                  );
                })}
              </div>
            </Panel>

            {selectedPlayerId !== null && (
              <PlayerTimelinePanel
                player={players.find((player) => player.id === selectedPlayerId) ?? null}
                playerId={selectedPlayerId}
                games={selectedPlayerGames}
              />
            )}
          </>
        ) : (
          <EmptyCard text="Player history appears after games are recorded." />
        ))}
    </>
  );
}

function InsightsPage({
  history,
  pairStats,
  players,
  streaks,
}: {
  history: GameHistoryItem[];
  pairStats: ReturnType<typeof bestPairings>;
  players: Player[];
  streaks: ReturnType<typeof longestWinStreaks>;
}) {
  const activePlayers = players.filter((player) => player.games > 0);

  // ── Top-of-page stat tiles
  const totalGames = history.length;
  const activeCount = activePlayers.length;
  const totalSeconds = history.reduce((sum, game) => sum + game.durationSeconds, 0);
  const avgSeconds = totalGames > 0 ? Math.round(totalSeconds / totalGames) : 0;

  // ── Leaderboards (parent already passes players sorted by MMR desc)
  const topMmr = activePlayers.slice(0, 5);
  const winRateLeaders = [...activePlayers]
    .filter((player) => player.games >= 3)
    .sort(
      (a, b) =>
        winRate(b.wins, b.games) - winRate(a.wins, a.games) || b.wins - a.wins || b.games - a.games,
    )
    .slice(0, 5);
  const mostActive = [...activePlayers].sort((a, b) => b.games - a.games).slice(0, 5);
  const topPairs = pairStats.slice(0, 5);

  // ── Bar scaling: keep bars visible across narrow ranges by lifting the floor.
  const mmrMin = topMmr.length ? Math.min(...topMmr.map((p) => p.mmr)) : 0;
  const mmrMax = topMmr.length ? Math.max(...topMmr.map((p) => p.mmr)) : 1;
  const mmrRange = mmrMax - mmrMin || 1;
  const scaleMmr = (mmr: number) => 30 + 70 * ((mmr - mmrMin) / mmrRange);
  const topActiveGames = mostActive[0]?.games ?? 1;
  const topStreak = streaks[0]?.wins ?? 1;

  // ── Game highlights
  const closest = closestGame(history);
  const longest = longestGame(history);
  const comeback = bestComeback(history);
  const lead = biggestLead(history);
  const upset = biggestUpset(history);
  const upsetMmrDiff = upset ? Math.round(underdogMargin(upset)) : 0;

  return (
    <>
      <PageHeader title="Insights" description="Leaderboards, analytics, and standout moments from your games." />

      {/* Hero stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={<Trophy size={12} />} label="Games" value={totalGames} />
        <StatTile icon={<Users size={12} />} label="Players" value={activeCount} />
        <StatTile icon={<Clock size={12} />} label="Court time" value={formatHoursMinutes(totalSeconds)} />
        <StatTile
          icon={<Activity size={12} />}
          label="Avg game"
          value={totalGames > 0 ? formatDuration(avgSeconds) : '—'}
        />
      </div>

      {/* Leaderboards (2×2 on wide screens) */}
      <div className="grid gap-3 lg:grid-cols-2">
        <LeaderPanel title="Top MMR" subtitle="Highest rated players" icon={<Crown size={14} />}>
          {topMmr.length > 0 ? (
            topMmr.map((player, index) => (
              <LeaderRow
                key={player.id}
                rank={index + 1}
                name={player.name}
                subtitle={`${player.wins}W · ${player.games}G · ${winRate(player.wins, player.games)}% win rate`}
                value={`${player.mmr}`}
                barPercent={scaleMmr(player.mmr)}
              />
            ))
          ) : (
            <EmptyRow>Record games to see MMR rankings.</EmptyRow>
          )}
        </LeaderPanel>

        <LeaderPanel title="Best Win Rate" subtitle="3+ games played" icon={<Target size={14} />}>
          {winRateLeaders.length > 0 ? (
            winRateLeaders.map((player, index) => {
              const rate = winRate(player.wins, player.games);
              return (
                <LeaderRow
                  key={player.id}
                  rank={index + 1}
                  name={player.name}
                  subtitle={`${player.wins}W · ${player.games - player.wins}L · ${player.games}G`}
                  value={`${rate}%`}
                  barPercent={rate}
                  barClass={rate >= 60 ? 'bg-success' : 'bg-primary'}
                />
              );
            })
          ) : (
            <EmptyRow>Play at least 3 games to qualify.</EmptyRow>
          )}
        </LeaderPanel>

        <LeaderPanel title="Most Active" subtitle="Games played" icon={<Flame size={14} />}>
          {mostActive.length > 0 ? (
            mostActive.map((player, index) => (
              <LeaderRow
                key={player.id}
                rank={index + 1}
                name={player.name}
                subtitle={`${player.wins}W · ${winRate(player.wins, player.games)}% win rate`}
                value={`${player.games}`}
                barPercent={(player.games / topActiveGames) * 100}
              />
            ))
          ) : (
            <EmptyRow>No games recorded yet.</EmptyRow>
          )}
        </LeaderPanel>

        <LeaderPanel title="Best Pairings" subtitle="Top win % together" icon={<Users size={14} />}>
          {topPairs.length > 0 ? (
            topPairs.map((pair, index) => {
              const [name1 = '?', name2 = '?'] = pair.names.split(' / ');
              const rate = winRate(pair.wins, pair.games);
              return (
                <PairRow
                  key={pair.key}
                  rank={index + 1}
                  name1={name1}
                  name2={name2}
                  subtitle={`${pair.wins}W · ${pair.games - pair.wins}L · ${pair.games}G together`}
                  value={`${rate}%`}
                  barPercent={rate}
                  barClass={rate >= 60 ? 'bg-success' : 'bg-primary'}
                />
              );
            })
          ) : (
            <EmptyRow>Pair stats appear after games are recorded.</EmptyRow>
          )}
        </LeaderPanel>
      </div>

      {/* Win streaks — own full-width panel for emphasis */}
      <LeaderPanel title="Longest Win Streaks" subtitle="Consecutive wins" icon={<Zap size={14} />}>
        {streaks.length > 0 ? (
          streaks.slice(0, 5).map((streak, index) => (
            <LeaderRow
              key={streak.id}
              rank={index + 1}
              name={streak.name}
              subtitle="Best recorded streak"
              value={`${streak.wins}W`}
              barPercent={(streak.wins / topStreak) * 100}
              barClass="bg-warning"
            />
          ))
        ) : (
          <EmptyRow>Win streaks appear after games are recorded.</EmptyRow>
        )}
      </LeaderPanel>

      {/* Game highlights */}
      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-lg font-semibold">Game highlights</h2>
          <p className="text-sm text-muted-foreground">Notable moments from your recorded games.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <HighlightCard
            icon={<Target size={14} />}
            tone="primary"
            label="Closest game"
            value={closest ? `${Math.abs(closest.score.teamA - closest.score.teamB)} pt margin` : null}
            game={closest ? gameLabel(closest) : null}
            detail={closest ? `${closest.winner} won ${gameScore(closest)}` : null}
            empty="No completed games yet."
          />
          <HighlightCard
            icon={<Hourglass size={14} />}
            tone="warning"
            label="Longest game"
            value={longest ? formatDuration(longest.durationSeconds) : null}
            game={longest ? gameLabel(longest) : null}
            detail={longest ? `${longest.winner} won ${gameScore(longest)}` : null}
            empty="No completed games yet."
          />
          <HighlightCard
            icon={<Rewind size={14} />}
            tone="success"
            label="Best comeback"
            value={comeback ? `${comeback.deficit} pt deficit` : null}
            game={comeback ? gameLabel(comeback.game) : null}
            detail={comeback ? `${comeback.game.winner} came back to win ${gameScore(comeback.game)}` : null}
            empty="Comebacks appear when a team wins after trailing."
          />
          <HighlightCard
            icon={<TrendingUp size={14} />}
            tone="primary"
            label="Biggest lead"
            value={lead ? `${lead.lead} pt lead` : null}
            game={lead ? gameLabel(lead.game) : null}
            detail={lead ? `Final ${gameScore(lead.game)}` : null}
            empty="Biggest leads appear after point-by-point games."
          />
          <HighlightCard
            icon={<Zap size={14} />}
            tone="destructive"
            label="Biggest upset"
            value={upset && upsetMmrDiff > 0 ? `${upsetMmrDiff} MMR diff` : null}
            game={upset && upsetMmrDiff > 0 ? gameLabel(upset) : null}
            detail={upset && upsetMmrDiff > 0 ? `${upset.winner} beat the higher-rated team` : null}
            empty="Upsets appear when a lower-MMR team wins."
          />
        </div>
      </div>
    </>
  );
}

function StatTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-primary/20 text-primary">{icon}</span>
        {label}
      </div>
      <p className="text-2xl font-extrabold leading-none tabular-nums">{value}</p>
    </Card>
  );
}

function LeaderPanel({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/20 text-primary">{icon}</span>
        <div>
          <h2 className="text-base font-semibold leading-tight">{title}</h2>
          <p className="text-xs leading-tight text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </Card>
  );
}

function LeaderRow({
  rank,
  name,
  subtitle,
  value,
  barPercent,
  barClass = 'bg-primary',
}: {
  rank: number;
  name: string;
  subtitle: string;
  value: string;
  barPercent: number;
  barClass?: string;
}) {
  const safe = Math.max(0, Math.min(100, barPercent));
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
          rank === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {rank}
      </span>
      <Avatar name={name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <span className="text-sm font-bold tabular-nums">{value}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500 ease-out', barClass)}
            style={{ width: `${safe}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function PairRow({
  rank,
  name1,
  name2,
  subtitle,
  value,
  barPercent,
  barClass = 'bg-primary',
}: {
  rank: number;
  name1: string;
  name2: string;
  subtitle: string;
  value: string;
  barPercent: number;
  barClass?: string;
}) {
  const safe = Math.max(0, Math.min(100, barPercent));
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
          rank === 1 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {rank}
      </span>
      <div className="flex shrink-0 gap-1">
        <Avatar name={name1} size={28} />
        <Avatar name={name2} size={28} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">
            {name1} & {name2}
          </p>
          <span className="text-sm font-bold tabular-nums">{value}</span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-all duration-500 ease-out', barClass)}
            style={{ width: `${safe}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function HighlightCard({
  icon,
  tone,
  label,
  value,
  game,
  detail,
  empty,
}: {
  icon: ReactNode;
  tone: 'primary' | 'success' | 'warning' | 'destructive';
  label: string;
  value: string | null;
  game: string | null;
  detail: string | null;
  empty: string;
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
    <Card className={cn('flex flex-col gap-2 border-l-4 p-4', borderTone, !value && 'opacity-60')}>
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <span className={cn('grid h-5 w-5 place-items-center rounded-md', iconTone)}>{icon}</span>
        {label}
      </div>
      {value ? (
        <>
          <p className="text-2xl font-extrabold leading-tight tabular-nums">{value}</p>
          {game && <p className="truncate text-sm font-semibold">{game}</p>}
          {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function formatHoursMinutes(totalSeconds: number) {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function GameHistoryCard({ game, index }: { game: GameHistoryItem; index: number }) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-foreground">#{index}</span>
          <span>{formatPlayedDate(game.playedAt)}</span>
          <span className="opacity-50">·</span>
          <span>{formatPlayedTime(game.playedAt)}</span>
          <span className="opacity-50">·</span>
          <span className="font-mono text-xs tabular-nums">{formatDuration(game.durationSeconds)}</span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-success/20 px-2.5 py-0.5 text-xs font-semibold text-success">
          <Crown size={12} />
          {game.winner} wins
        </span>
      </div>

      <div className="grid grid-cols-2">
        <HistoryTeamSide
          team="Team A"
          players={game.teamA}
          score={game.score.teamA}
          isWinner={game.winner === 'Team A'}
        />
        <div className="-mx-px border-l border-dashed border-border" />
        <HistoryTeamSide
          team="Team B"
          players={game.teamB}
          score={game.score.teamB}
          isWinner={game.winner === 'Team B'}
          rightSide
        />
      </div>
    </Card>
  );
}

function HistoryTeamSide({
  team,
  players,
  score,
  isWinner,
  rightSide,
}: {
  team: string;
  players: GameHistoryItem['teamA'];
  score: number;
  isWinner: boolean;
  rightSide?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md p-3',
        rightSide ? 'pl-4' : 'pr-4',
        isWinner && 'bg-success/10',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{team}</span>
        {isWinner && <Crown size={14} className="text-success" />}
      </div>
      <div className="flex flex-col gap-1.5">
        {players.map((player) => (
          <div key={player.id} className="flex items-center gap-2">
            <Avatar name={player.name} size={24} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{player.mmr}</span>
          </div>
        ))}
      </div>
      <span
        className={cn(
          'text-3xl font-black tabular-nums leading-none',
          isWinner ? 'text-success' : 'text-foreground',
        )}
      >
        {score}
      </span>
    </div>
  );
}

function PlayerTimelinePanel({
  player,
  playerId,
  games,
}: {
  player: Player | null;
  playerId: number;
  games: GameHistoryItem[];
}) {
  const wins = games.filter((game) => {
    const winningTeam = game.winner === 'Team A' ? game.teamA : game.teamB;
    return winningTeam.some((member) => member.id === playerId);
  }).length;
  const total = games.length;

  return (
    <Panel>
      <div className="flex items-center gap-3">
        <Avatar name={player?.name ?? '?'} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{player?.name ?? 'Unknown player'}</p>
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? `${wins}W · ${total - wins}L · ${total}G · ${winRate(wins, total)}% win rate`
              : 'No recorded games yet.'}
          </p>
        </div>
      </div>
      {games.length > 0 && (
        <div className="flex flex-col">
          {games.map((game, index) => (
            <PlayerTimelineRow
              key={game.id}
              game={game}
              playerId={playerId}
              divider={index !== games.length - 1}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function PlayerTimelineRow({
  game,
  playerId,
  divider,
}: {
  game: GameHistoryItem;
  playerId: number;
  divider?: boolean;
}) {
  const winningTeam = game.winner === 'Team A' ? game.teamA : game.teamB;
  const won = winningTeam.some((player) => player.id === playerId);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2.5',
        divider && 'border-b border-border/60',
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{gameLabel(game)}</p>
        <p className="text-xs text-muted-foreground">
          {formatPlayedDate(game.playedAt)} · {formatPlayedTime(game.playedAt)}
        </p>
      </div>
      <div
        className={cn(
          'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums',
          won ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive',
        )}
      >
        {won ? 'W' : 'L'} · {gameScore(game)}
      </div>
    </div>
  );
}

function PageHeader({ description, title }: { description: string; title: string }) {
  return (
    <div className="space-y-1">
      <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn('flex flex-col gap-3 p-4', className)}>{children}</Card>;
}

function StatusBox({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-semibold leading-none', valueClassName)}>{value}</p>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground',
        active && 'bg-primary/10 text-primary hover:text-primary',
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function ConfirmDialog({
  actionLabel,
  description,
  isLoading = false,
  onCancel,
  onConfirm,
  title,
  variant,
}: {
  actionLabel: string;
  description: string;
  isLoading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  variant: 'success' | 'destructive';
}) {
  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-foreground/55 p-4">
      <Card className="w-full max-w-md p-4">
        <CardHeader className="p-0">
          <CardTitle className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-end gap-2 p-0 pt-4">
          <Button disabled={isLoading} onClick={onCancel} variant="outline">
            Cancel
          </Button>
          <Button disabled={isLoading} onClick={onConfirm} variant={variant}>
            {isLoading ? 'Recording...' : actionLabel}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Panel>
      <p className="text-sm text-muted-foreground">{text}</p>
    </Panel>
  );
}

function formatPlayedDate(playedAt: number) {
  return new Date(playedAt).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPlayedTime(playedAt: number) {
  return new Date(playedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
