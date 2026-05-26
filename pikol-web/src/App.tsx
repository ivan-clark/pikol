import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, History, Trophy, Users } from 'lucide-react';

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

type Page = 'game' | 'players' | 'history' | 'insights';
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

  return (
    <div className="min-h-screen pb-24">
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

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-4 gap-1 p-2">
          <NavButton active={page === 'game'} icon={<Trophy size={20} />} label="Game" onClick={() => setPage('game')} />
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

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-card p-1">
        {(['games', 'pairs', 'players'] as const).map((view) => (
          <button
            className={cn('min-h-10 rounded-md text-sm font-semibold capitalize', historyView === view && 'bg-muted')}
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
            {pairStats.map((pair) => (
              <SummaryRow
                detail={`${pair.wins}W / ${pair.games - pair.wins}L / ${pair.games}G together`}
                key={pair.key}
                label={pair.names}
                value={`${winRate(pair.wins, pair.games)}%`}
              />
            ))}
          </Panel>
        ) : (
          <EmptyCard text="Pair history appears after games are recorded." />
        ))}

      {historyView === 'players' &&
        (players.length > 0 ? (
          <>
            <Panel className="flex-row flex-wrap">
              {players.map((player) => (
                <Button
                  key={player.id}
                  onClick={() => onSelectPlayer(player.id)}
                  variant={selectedPlayerId === player.id ? 'default' : 'ghost'}
                >
                  {player.name}
                </Button>
              ))}
            </Panel>

            <Panel>
              <h2 className="text-2xl font-semibold tracking-normal">
                {players.find((player) => player.id === selectedPlayerId)?.name ?? 'Select a player'}
              </h2>
              {selectedPlayerId === null && <p className="text-sm text-muted-foreground">Select a player to see their chronological games.</p>}
              {selectedPlayerId !== null && selectedPlayerGames.length === 0 && (
                <p className="text-sm text-muted-foreground">No games for this player yet.</p>
              )}
              {selectedPlayerGames.map((game) => (
                <PlayerTimelineRow game={game} key={game.id} playerId={selectedPlayerId ?? 0} />
              ))}
            </Panel>
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
  const bestWinRatePlayers = [...players]
    .filter((player) => player.games > 0)
    .sort((a, b) => winRate(b.wins, b.games) - winRate(a.wins, a.games) || b.wins - a.wins || b.games - a.games)
    .slice(0, 3);
  const closest = closestGame(history);
  const longest = longestGame(history);
  const comeback = bestComeback(history);
  const lead = biggestLead(history);
  const upset = biggestUpset(history);

  return (
    <>
      <PageHeader title="Insights" description="Quick reads from player ratings and recorded game history." />

      <InsightPanel title="Top MMR">
        {players.slice(0, 3).map((player, index) => (
          <SummaryRow key={player.id} label={`${index + 1}. ${player.name}`} value={`${player.mmr} MMR`} detail={`${player.wins}W / ${player.games}G`} />
        ))}
      </InsightPanel>

      <InsightPanel title="Best Win Rate">
        {bestWinRatePlayers.length > 0 ? (
          bestWinRatePlayers.map((player) => (
            <SummaryRow key={player.id} label={player.name} value={`${winRate(player.wins, player.games)}%`} detail={`${player.wins}W / ${player.games}G`} />
          ))
        ) : (
          <EmptyText>Record matches to calculate win rates.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Best Pairings">
        {pairStats.length > 0 ? (
          pairStats.slice(0, 3).map((pair) => (
            <SummaryRow key={pair.key} label={pair.names} value={`${winRate(pair.wins, pair.games)}%`} detail={`${pair.wins}W / ${pair.games}G together`} />
          ))
        ) : (
          <EmptyText>Team records appear after games are recorded.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Most Active">
        {players.slice().sort((a, b) => b.games - a.games).slice(0, 3).map((player) => (
          <SummaryRow key={player.id} label={player.name} value={`${player.games} games`} detail={`${player.wins} wins`} />
        ))}
      </InsightPanel>

      <InsightPanel title="Longest Win Streak">
        {streaks.length > 0 ? (
          streaks.slice(0, 3).map((streak) => <SummaryRow key={streak.id} label={streak.name} value={`${streak.wins}W`} detail="Best recorded streak" />)
        ) : (
          <EmptyText>Win streaks appear after games are recorded.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Closest Game">
        {closest ? (
          <SummaryRow label={gameLabel(closest)} value={gameScore(closest)} detail={`${closest.winner} won by ${Math.abs(closest.score.teamA - closest.score.teamB)}`} />
        ) : (
          <EmptyText>No completed games yet.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Longest Game">
        {longest ? (
          <SummaryRow label={gameLabel(longest)} value={formatDuration(longest.durationSeconds)} detail={`${longest.winner} won ${gameScore(longest)}`} />
        ) : (
          <EmptyText>No completed games yet.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Best Comeback">
        {comeback ? (
          <SummaryRow label={gameLabel(comeback.game)} value={`${comeback.deficit} pts`} detail={`${comeback.game.winner} came back to win ${gameScore(comeback.game)}`} />
        ) : (
          <EmptyText>Comebacks appear when a team wins after trailing during the game.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Biggest Lead">
        {lead ? (
          <SummaryRow label={gameLabel(lead.game)} value={`${lead.lead} pts`} detail={`Final ${gameScore(lead.game)}`} />
        ) : (
          <EmptyText>Biggest leads appear after point-by-point games are recorded.</EmptyText>
        )}
      </InsightPanel>

      <InsightPanel title="Biggest Upset">
        {upset && underdogMargin(upset) > 0 ? (
          <SummaryRow label={gameLabel(upset)} value={`${Math.round(underdogMargin(upset))} MMR`} detail={`${upset.winner} beat the higher-rated team`} />
        ) : (
          <EmptyText>Upsets appear when a lower-MMR team wins.</EmptyText>
        )}
      </InsightPanel>
    </>
  );
}

function GameHistoryCard({ game, index }: { game: GameHistoryItem; index: number }) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Game #{index}</p>
          <p className="text-sm text-muted-foreground">{formatPlayedDate(game.playedAt)}</p>
          <p className="text-sm text-muted-foreground">
            {formatPlayedTime(game.playedAt)} - {formatDuration(game.durationSeconds)}
          </p>
        </div>
        <Badge variant="success">{game.winner}</Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <TeamSummary title="Team A" players={game.teamA} score={game.score.teamA} />
        <TeamSummary title="Team B" players={game.teamB} score={game.score.teamB} />
      </div>
    </Panel>
  );
}

function TeamSummary({ players, score, title }: { players: GameHistoryItem['teamA']; score: number; title: string }) {
  return (
    <div className="space-y-1 rounded-md bg-background p-3">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-4xl font-bold leading-none">{score}</p>
      <p>{players.map((player) => `${player.name} (${player.mmr})`).join(' / ')}</p>
    </div>
  );
}

function PlayerTimelineRow({ game, playerId }: { game: GameHistoryItem; playerId: number }) {
  const winningTeam = game.winner === 'Team A' ? game.teamA : game.teamB;
  const won = winningTeam.some((player) => player.id === playerId);

  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md bg-background px-3">
      <div>
        <p>{gameLabel(game)}</p>
        <p className="text-sm text-muted-foreground">
          {formatPlayedDate(game.playedAt)} - {formatPlayedTime(game.playedAt)}
        </p>
      </div>
      <Badge variant={won ? 'success' : 'destructive'}>
        {won ? 'W' : 'L'} {gameScore(game)}
      </Badge>
    </div>
  );
}

function InsightPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Panel>
      <h2 className="text-2xl font-semibold tracking-normal">{title}</h2>
      {children}
    </Panel>
  );
}

function SummaryRow({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 rounded-md bg-background px-3">
      <div className="min-w-0 flex-1">
        <p className="truncate">{label}</p>
        <p className="text-sm text-muted-foreground">{detail}</p>
      </div>
      <p className="shrink-0 text-right text-sm font-semibold">{value}</p>
    </div>
  );
}

function PageHeader({ description, title }: { description: string; title: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-5xl font-bold tracking-normal">{title}</h1>
      <p className="text-muted-foreground">{description}</p>
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
        'flex min-h-14 flex-col items-center justify-center gap-1 rounded-md px-2 text-xs font-semibold text-muted-foreground transition-colors',
        active && 'bg-muted text-foreground',
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

function EmptyText({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
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
