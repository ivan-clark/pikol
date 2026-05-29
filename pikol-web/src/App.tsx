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
  LayoutDashboard,
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
import { DashboardPage } from './components/DashboardPage';
import { OpenPlayPage } from './components/OpenPlayPage';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { api } from './lib/api';
import {
  formatDuration,
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
import type { GameHistoryItem, Player } from './lib/types';

type Page = 'dashboard' | 'openplay' | 'players' | 'history' | 'insights';
type HistoryView = 'games' | 'pairs' | 'players';
type PendingAction = 'add-player' | 'reset' | `availability-${number}` | null;

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [players, setPlayers] = useState<Player[]>([]);
  const [history, setHistory] = useState<GameHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [apiError, setApiError] = useState('');
  const [newPlayerName, setNewPlayerName] = useState('');
  const [playerNameError, setPlayerNameError] = useState('');
  const [historyView, setHistoryView] = useState<HistoryView>('games');
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const isAddingPlayer = pendingAction === 'add-player';
  const isResetting = pendingAction === 'reset';

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
  async function loadInitialData() {
    setIsLoading(true);
    setApiError('');

    try {
      const [loadedPlayers, loadedHistory] = await Promise.all([
        api.getPlayers(),
        api.getHistory(),
      ]);

      setPlayers(loadedPlayers);
      setHistory(loadedHistory);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'Unable to connect to the API.');
    } finally {
      setIsLoading(false);
    }
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
        {page === 'dashboard' && (
          <DashboardPage
            players={players}
            history={history}
            onGoToOpenPlay={() => setPage('openplay')}
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
            players={rankedPlayers}
            selectedPlayerId={selectedPlayerId}
          />
        )}
        {page === 'insights' && <InsightsPage history={history} players={rankedPlayers} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 backdrop-blur">
        <div className="mx-auto grid max-w-2xl grid-cols-5 gap-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <NavButton active={page === 'dashboard'} icon={<LayoutDashboard size={20} />} label="Dashboard" onClick={() => setPage('dashboard')} />
          <NavButton active={page === 'openplay'} icon={<LayoutGrid size={20} />} label="Open Play" onClick={() => setPage('openplay')} />
          <NavButton active={page === 'players'} icon={<Users size={20} />} label="Players" onClick={() => setPage('players')} />
          <NavButton active={page === 'history'} icon={<History size={20} />} label="History" onClick={() => setPage('history')} />
          <NavButton active={page === 'insights'} icon={<BarChart3 size={20} />} label="Insights" onClick={() => setPage('insights')} />
        </div>
      </nav>

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

// ── History date filter helpers ────────────────────────────────────────────

type HistoryDatePreset = 'all' | 'today' | 'yesterday' | '7d' | '30d';

const HISTORY_DATE_PRESETS: { value: HistoryDatePreset; label: string; phrase: string }[] = [
  { value: 'all', label: 'All', phrase: 'all time' },
  { value: 'today', label: 'Today', phrase: 'today' },
  { value: 'yesterday', label: 'Yesterday', phrase: 'yesterday' },
  { value: '7d', label: '7d', phrase: 'the last 7 days' },
  { value: '30d', label: '30d', phrase: 'the last 30 days' },
];

function historyRangeFromPreset(preset: HistoryDatePreset): { from: number | null; to: number | null } {
  const day = 24 * 60 * 60 * 1000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  switch (preset) {
    case 'all':
      return { from: null, to: null };
    case 'today':
      return { from: startOfTodayMs, to: null };
    case 'yesterday':
      return { from: startOfTodayMs - day, to: startOfTodayMs };
    case '7d':
      return { from: Date.now() - 7 * day, to: null };
    case '30d':
      return { from: Date.now() - 30 * day, to: null };
  }
}

function HistoryPage({
  history,
  historyView,
  onSelectPlayer,
  onViewChange,
  players,
  selectedPlayerId,
}: {
  history: GameHistoryItem[];
  historyView: HistoryView;
  onSelectPlayer: (id: number) => void;
  onViewChange: (view: HistoryView) => void;
  players: Player[];
  selectedPlayerId: number | null;
}) {
  const [dateFilter, setDateFilter] = useState<HistoryDatePreset>('all');

  // Filter once, then derive everything from filteredHistory.
  const filteredHistory = useMemo(() => {
    const range = historyRangeFromPreset(dateFilter);
    if (range.from == null && range.to == null) return history;
    return history.filter((game) => {
      if (range.from != null && game.playedAt < range.from) return false;
      if (range.to != null && game.playedAt >= range.to) return false;
      return true;
    });
  }, [history, dateFilter]);

  const pairStats = useMemo(() => bestPairings(filteredHistory), [filteredHistory]);

  const selectedPlayerGames = useMemo(() => {
    if (!selectedPlayerId) return [];
    return [...filteredHistory]
      .reverse()
      .filter((game) => [...game.teamA, ...game.teamB].some((player) => player.id === selectedPlayerId));
  }, [filteredHistory, selectedPlayerId]);

  // Preserve each game's original chronological number across the full history,
  // so filtering doesn't make "Game #N" relabel to a smaller index.
  const gameNumberById = useMemo(() => {
    const map = new Map<number, number>();
    history.forEach((game, index) => map.set(game.id, history.length - index));
    return map;
  }, [history]);

  const activePreset = HISTORY_DATE_PRESETS.find((preset) => preset.value === dateFilter);
  const isFiltered = dateFilter !== 'all';
  return (
    <>
      <PageHeader title="History" description="Review games, player records, and pair performance." />

      {/* Date filter — drives the Games list, Pairs leaderboard, and Players timeline */}
      <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-muted p-1">
        {HISTORY_DATE_PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => setDateFilter(preset.value)}
            className={cn(
              'min-h-9 rounded-md text-xs font-semibold text-muted-foreground transition-colors',
              dateFilter === preset.value && 'bg-card text-foreground shadow-sm',
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {isFiltered && activePreset && (
        <p className="-mt-1 text-sm text-muted-foreground">
          Showing {filteredHistory.length} {filteredHistory.length === 1 ? 'game' : 'games'} from{' '}
          {activePreset.phrase}.
        </p>
      )}

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
        (filteredHistory.length > 0 ? (
          filteredHistory.map((game) => (
            <GameHistoryCard game={game} index={gameNumberById.get(game.id) ?? 0} key={game.id} />
          ))
        ) : (
          <EmptyCard
            text={
              isFiltered
                ? `No games recorded ${activePreset?.phrase ?? 'in this range'}.`
                : 'Recorded games will appear here after you finish a match on the Game tab.'
            }
          />
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
          <EmptyCard
            text={
              isFiltered
                ? `No pair stats ${activePreset?.phrase ?? 'in this range'} yet.`
                : 'Pair history appears after games are recorded.'
            }
          />
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

// ── Insights filter helpers ─────────────────────────────────────────────────

type DatePreset = 'all' | '7d' | '30d' | '90d' | 'year';

const DATE_PRESETS: { value: DatePreset; label: string; short: string }[] = [
  { value: 'all', label: 'All time', short: 'All' },
  { value: '7d', label: 'Last 7 days', short: '7d' },
  { value: '30d', label: 'Last 30 days', short: '30d' },
  { value: '90d', label: 'Last 90 days', short: '90d' },
  { value: 'year', label: 'This year', short: 'Year' },
];

function rangeFromPreset(preset: DatePreset): { from: number | null } {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  switch (preset) {
    case 'all':
      return { from: null };
    case '7d':
      return { from: now - 7 * day };
    case '30d':
      return { from: now - 30 * day };
    case '90d':
      return { from: now - 90 * day };
    case 'year':
      return { from: new Date(new Date().getFullYear(), 0, 1).getTime() };
  }
}

// Rebuild per-player stats from a (possibly filtered) history. MMR is taken from
// the most recent snapshot in the filtered window, so the leaderboard reflects
// "rating as of the end of this range" rather than career MMR.
function rollupPlayersFromHistory(history: GameHistoryItem[]): Player[] {
  const rolled = new Map<number, { games: number; wins: number; mmr: number; name: string }>();
  const chronological = [...history].sort((a, b) => a.playedAt - b.playedAt);
  for (const game of chronological) {
    const winnerIds = new Set(
      (game.winner === 'Team A' ? game.teamA : game.teamB).map((player) => player.id),
    );
    for (const snapshot of [...game.teamA, ...game.teamB]) {
      const entry = rolled.get(snapshot.id) ?? {
        games: 0,
        wins: 0,
        mmr: snapshot.mmr,
        name: snapshot.name,
      };
      entry.games += 1;
      if (winnerIds.has(snapshot.id)) entry.wins += 1;
      entry.mmr = snapshot.mmr; // latest snapshot in this window
      entry.name = snapshot.name;
      rolled.set(snapshot.id, entry);
    }
  }
  return [...rolled.entries()]
    .map(([id, entry]) => ({
      id,
      name: entry.name,
      games: entry.games,
      wins: entry.wins,
      mmr: entry.mmr,
      available: true,
    }))
    .sort(
      (a, b) => b.mmr - a.mmr || b.wins - a.wins || a.name.localeCompare(b.name),
    );
}

function InsightsPage({
  history,
  players: rosterPlayers,
}: {
  history: GameHistoryItem[];
  players: Player[];
}) {
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [playerFilter, setPlayerFilter] = useState<number | null>(null);

  const range = useMemo(() => rangeFromPreset(datePreset), [datePreset]);

  const filteredHistory = useMemo(
    () =>
      history.filter((game) => {
        if (range.from != null && game.playedAt < range.from) return false;
        if (playerFilter != null) {
          const inGame = [...game.teamA, ...game.teamB].some(
            (player) => player.id === playerFilter,
          );
          if (!inGame) return false;
        }
        return true;
      }),
    [history, range, playerFilter],
  );

  const filteredPlayers = useMemo(
    () => rollupPlayersFromHistory(filteredHistory),
    [filteredHistory],
  );
  const filteredPairStats = useMemo(
    () => bestPairings(filteredHistory),
    [filteredHistory],
  );
  const filteredStreaks = useMemo(
    () => longestWinStreaks(filteredHistory),
    [filteredHistory],
  );

  const isFiltered = datePreset !== 'all' || playerFilter !== null;
  const activePreset = DATE_PRESETS.find((preset) => preset.value === datePreset);
  const filterPlayerName =
    playerFilter != null
      ? rosterPlayers.find((player) => player.id === playerFilter)?.name ?? null
      : null;

  // ── Top-of-page stat tiles
  const totalGames = filteredHistory.length;
  const activeCount = filteredPlayers.length;
  const totalSeconds = filteredHistory.reduce(
    (sum, game) => sum + game.durationSeconds,
    0,
  );
  const avgSeconds = totalGames > 0 ? Math.round(totalSeconds / totalGames) : 0;

  // ── Leaderboards
  const topMmr = filteredPlayers.slice(0, 5);
  const winRateLeaders = [...filteredPlayers]
    .filter((player) => player.games >= 3)
    .sort(
      (a, b) =>
        winRate(b.wins, b.games) - winRate(a.wins, a.games) || b.wins - a.wins || b.games - a.games,
    )
    .slice(0, 5);
  const mostActive = [...filteredPlayers].sort((a, b) => b.games - a.games).slice(0, 5);
  const topPairs = filteredPairStats.slice(0, 5);

  // ── Bar scaling: keep bars visible across narrow ranges by lifting the floor.
  const mmrMin = topMmr.length ? Math.min(...topMmr.map((p) => p.mmr)) : 0;
  const mmrMax = topMmr.length ? Math.max(...topMmr.map((p) => p.mmr)) : 1;
  const mmrRange = mmrMax - mmrMin || 1;
  const scaleMmr = (mmr: number) => 30 + 70 * ((mmr - mmrMin) / mmrRange);
  const topActiveGames = mostActive[0]?.games ?? 1;
  const topStreak = filteredStreaks[0]?.wins ?? 1;

  // ── Game highlights
  const closest = closestGame(filteredHistory);
  const longest = longestGame(filteredHistory);
  const comeback = bestComeback(filteredHistory);
  const lead = biggestLead(filteredHistory);
  const upset = biggestUpset(filteredHistory);
  const upsetMmrDiff = upset ? Math.round(underdogMargin(upset)) : 0;

  return (
    <>
      <PageHeader title="Insights" description="Leaderboards, analytics, and standout moments from your games." />

      {/* Filter bar */}
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Filters
          </h2>
          {isFiltered && (
            <button
              type="button"
              onClick={() => {
                setDatePreset('all');
                setPlayerFilter(null);
              }}
              className="text-xs font-semibold text-primary hover:underline"
            >
              Reset
            </button>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Date range
          </p>
          <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-muted p-1">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setDatePreset(preset.value)}
                className={cn(
                  'min-h-9 rounded-md text-xs font-semibold text-muted-foreground transition-colors',
                  datePreset === preset.value && 'bg-card text-foreground shadow-sm',
                )}
              >
                {preset.short}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Player
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPlayerFilter(null)}
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                playerFilter === null
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              All players
            </button>
            {rosterPlayers.map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => setPlayerFilter(player.id)}
                className={cn(
                  'flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 text-sm font-medium transition-colors',
                  playerFilter === player.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card hover:bg-muted',
                )}
              >
                <Avatar name={player.name} size={24} />
                <span>{player.name}</span>
              </button>
            ))}
          </div>
        </div>

        {isFiltered && (
          <p className="text-sm text-muted-foreground">
            Showing {totalGames} {totalGames === 1 ? 'game' : 'games'}
            {activePreset && activePreset.value !== 'all' && <> in {activePreset.label.toLowerCase()}</>}
            {filterPlayerName && <> involving {filterPlayerName}</>}.
          </p>
        )}
      </Card>

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
            <EmptyRow>
              {isFiltered ? 'No games in this range yet.' : 'Record games to see MMR rankings.'}
            </EmptyRow>
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
        {filteredStreaks.length > 0 ? (
          filteredStreaks.slice(0, 5).map((streak, index) => (
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

