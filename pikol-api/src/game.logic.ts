import type { GameHistoryItem, Match, Player, PlayerSnapshot, Score, TeamName } from './types';

export const WINNING_SCORE = 11;
export const DEUCE_SCORE = 10;
export const WIN_BY_POINTS = 2;
export const STARTING_MMR = 1000;
export const MMR_K_FACTOR = 32;

export function snapshotTeam(team: Player[]): PlayerSnapshot[] {
  return team.map((player) => ({
    id: player.id,
    name: player.name,
    mmr: player.mmr,
  }));
}

export function getWinner(score: Score): TeamName | null {
  const highestScore = Math.max(score.teamA, score.teamB);
  const scoreDifference = Math.abs(score.teamA - score.teamB);
  const isDeuceRange = score.teamA >= DEUCE_SCORE && score.teamB >= DEUCE_SCORE;

  if (highestScore < WINNING_SCORE) return null;
  if (isDeuceRange && scoreDifference < WIN_BY_POINTS) return null;
  if (scoreDifference >= WIN_BY_POINTS) return score.teamA > score.teamB ? 'Team A' : 'Team B';

  return null;
}

export function winRate(wins: number, games: number) {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
}

function shufflePlayers(players: Player[]) {
  return [...players]
    .map((player) => ({ player, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ player }) => player);
}

function getTeamMmr(team: Player[]) {
  return team.reduce((total, player) => total + player.mmr, 0) / team.length;
}

function getExpectedScore(teamMmr: number, opponentMmr: number) {
  return 1 / (1 + 10 ** ((opponentMmr - teamMmr) / 400));
}

function getPairKey(players: Pick<Player, 'id'>[]) {
  return players
    .map((player) => player.id)
    .sort((a, b) => a - b)
    .join(':');
}

function getPairPlayCount(history: GameHistoryItem[], players: Player[]) {
  const pairKey = getPairKey(players);

  return history.filter((game) => getPairKey(game.teamA) === pairKey || getPairKey(game.teamB) === pairKey).length;
}

function pairKey(a: Pick<Player, 'id'>, b: Pick<Player, 'id'>) {
  return a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
}

// How many times this two-player partnership has happened *in the current open-play
// session*. Used to make pairings rotate before repeating.
function sessionPairCount(
  counts: Record<string, number> | undefined,
  pair: Player[],
): number {
  if (!counts || pair.length < 2) return 0;
  return counts[pairKey(pair[0], pair[1])] ?? 0;
}

// From four players, choose the 2v2 split that:
//   1. minimizes repeats of partnerships already used *this session*  ← new
//   2. then minimizes all-time partnership repeats from history
//   3. then keeps the two teams closest in average MMR.
function bestPairing(
  four: Player[],
  history: GameHistoryItem[],
  sessionPairCounts?: Record<string, number>,
): Match {
  const pairings: [Player[], Player[]][] = [
    [
      [four[0], four[1]],
      [four[2], four[3]],
    ],
    [
      [four[0], four[2]],
      [four[1], four[3]],
    ],
    [
      [four[0], four[3]],
      [four[1], four[2]],
    ],
  ];

  const [teamA, teamB] = pairings.sort((firstPairing, secondPairing) => {
    const firstSessionPairs =
      sessionPairCount(sessionPairCounts, firstPairing[0]) +
      sessionPairCount(sessionPairCounts, firstPairing[1]);
    const secondSessionPairs =
      sessionPairCount(sessionPairCounts, secondPairing[0]) +
      sessionPairCount(sessionPairCounts, secondPairing[1]);
    const firstPairRepeatCount =
      getPairPlayCount(history, firstPairing[0]) + getPairPlayCount(history, firstPairing[1]);
    const secondPairRepeatCount =
      getPairPlayCount(history, secondPairing[0]) + getPairPlayCount(history, secondPairing[1]);
    const firstDifference = Math.abs(getTeamMmr(firstPairing[0]) - getTeamMmr(firstPairing[1]));
    const secondDifference = Math.abs(getTeamMmr(secondPairing[0]) - getTeamMmr(secondPairing[1]));

    return (
      firstSessionPairs - secondSessionPairs ||
      firstPairRepeatCount - secondPairRepeatCount ||
      firstDifference - secondDifference
    );
  })[0];

  return { teamA, teamB };
}

export function pickMatch(players: Player[], history: GameHistoryItem[]): Match | null {
  if (players.length < 4) return null;

  const selectedPlayers = shufflePlayers(players)
    .sort((a, b) => a.games - b.games)
    .slice(0, 4);

  return bestPairing(selectedPlayers, history);
}

// ── Court-selection helpers ────────────────────────────────────────────────

// Sum of session pair counts across the 6 partnerships inside a tetrad.
// Lower = the four players have more "fresh" partnerships available.
function tetradSessionSum(four: Player[], counts?: Record<string, number>): number {
  if (!counts) return 0;
  let total = 0;
  for (let i = 0; i < four.length; i++) {
    for (let j = i + 1; j < four.length; j++) {
      total += counts[pairKey(four[i], four[j])] ?? 0;
    }
  }
  return total;
}

// Sum of all-time history pair counts across the 6 partnerships inside a tetrad.
function tetradHistorySum(four: Player[], history: GameHistoryItem[]): number {
  let total = 0;
  for (let i = 0; i < four.length; i++) {
    for (let j = i + 1; j < four.length; j++) {
      total += getPairPlayCount(history, [four[i], four[j]]);
    }
  }
  return total;
}

// Minimum MMR difference across the 3 possible 2v2 splits — proxy for "best
// balance achievable" within this tetrad.
function tetradMinMmrDiff(four: Player[]): number {
  if (four.length < 4) return 0;
  const splits: [Player[], Player[]][] = [
    [[four[0], four[1]], [four[2], four[3]]],
    [[four[0], four[2]], [four[1], four[3]]],
    [[four[0], four[3]], [four[1], four[2]]],
  ];
  return Math.min(
    ...splits.map(([a, b]) => Math.abs(getTeamMmr(a) - getTeamMmr(b))),
  );
}

// Lex compare two tetrads: lower is better. Order: session pairs → history → MMR.
function compareTetrads(
  a: Player[],
  b: Player[],
  history: GameHistoryItem[],
  sessionPairCounts?: Record<string, number>,
): number {
  const aSession = tetradSessionSum(a, sessionPairCounts);
  const bSession = tetradSessionSum(b, sessionPairCounts);
  if (aSession !== bSession) return aSession - bSession;
  const aHistory = tetradHistorySum(a, history);
  const bHistory = tetradHistorySum(b, history);
  if (aHistory !== bHistory) return aHistory - bHistory;
  return tetradMinMmrDiff(a) - tetradMinMmrDiff(b);
}

// Split `remaining` into players that MUST play next (strictly fewer games than
// the 4th lowest) and players in the "decisive tier" where we have flexibility.
function partitionFairTier(
  remaining: Player[],
  gamesOf: (p: Player) => number,
): { forced: Player[]; flex: Player[] } {
  // Stable sort keeps FIFO order within each games-played tier.
  const sorted = [...remaining].sort((a, b) => gamesOf(a) - gamesOf(b));
  const cutoff = gamesOf(sorted[3]);
  return {
    forced: sorted.filter((p) => gamesOf(p) < cutoff),
    flex: sorted.filter((p) => gamesOf(p) === cutoff),
  };
}

// From a tier with surplus (more candidates than seats needed), pick the 4 that
// minimize partnership repeats. Enumeration is in lex order so FIFO order is the
// natural tiebreak when every candidate combo is equally good.
function pickBestFour(
  forced: Player[],
  flex: Player[],
  history: GameHistoryItem[],
  sessionPairCounts?: Record<string, number>,
): Player[] {
  const need = 4 - forced.length;
  if (need <= 0) return forced.slice(0, 4);
  if (flex.length <= need) return [...forced, ...flex.slice(0, need)];

  let best: Player[] | null = null;
  const indices = Array.from({ length: need }, (_, i) => i);

  for (;;) {
    const subset = indices.map((i) => flex[i]);
    const candidate = [...forced, ...subset];
    if (best === null || compareTetrads(candidate, best, history, sessionPairCounts) < 0) {
      best = candidate;
    }
    // Advance to next k-combination in lex order.
    let i = need - 1;
    while (i >= 0 && indices[i] === flex.length - need + i) i--;
    if (i < 0) break;
    indices[i]++;
    for (let j = i + 1; j < need; j++) indices[j] = indices[j - 1] + 1;
  }

  return best ?? [...forced, ...flex.slice(0, need)];
}

function bumpPairCount(counts: Record<string, number>, pair: Player[]) {
  if (pair.length < 2) return;
  const key = pairKey(pair[0], pair[1]);
  counts[key] = (counts[key] ?? 0) + 1;
}

// Open play: fill up to `courtCount` courts by pulling players off the queue.
// With `sessionGamesPlayed`, the matchmaker treats players with the same session
// game count as a "fair tier" and, when the tier has surplus, picks the 4 that
// best diversify partnerships — so all pairs get a turn before any pair repeats.
// Fairness is strictly preserved: anyone with fewer session games is always
// seated before someone with more, regardless of partnership variety.
export function assignCourts(
  orderedPlayers: Player[],
  history: GameHistoryItem[],
  courtCount: number,
  sessionPairCounts?: Record<string, number>,
  sessionGamesPlayed?: Record<number, number>,
): { courts: Match[]; waiting: Player[] } {
  const courts: Match[] = [];
  let remaining = [...orderedPlayers];
  // Local mutable copy so multi-court fills account for the pair we just used.
  const counts: Record<string, number> = { ...(sessionPairCounts ?? {}) };
  const gamesOf = (player: Player) => sessionGamesPlayed?.[player.id] ?? 0;

  while (courts.length < courtCount && remaining.length >= 4) {
    const { forced, flex } = partitionFairTier(remaining, gamesOf);
    const four = pickBestFour(forced, flex, history, counts);
    const pairing = bestPairing(four, history, counts);
    courts.push(pairing);

    // Update local pair counts so the next court iteration sees the just-used pair.
    bumpPairCount(counts, pairing.teamA);
    bumpPairCount(counts, pairing.teamB);

    const fourIds = new Set(four.map((p) => p.id));
    remaining = remaining.filter((p) => !fourIds.has(p.id));
  }

  return { courts, waiting: remaining };
}

export function applyMatchResult(players: Player[], match: Match, winner: TeamName) {
  const selectedIds = new Set([...match.teamA, ...match.teamB].map((player) => player.id));
  const winningTeam = winner === 'Team A' ? match.teamA : match.teamB;
  const losingTeam = winner === 'Team A' ? match.teamB : match.teamA;
  const winningIds = new Set(winningTeam.map((player) => player.id));
  const losingIds = new Set(losingTeam.map((player) => player.id));
  const teamAMmr = getTeamMmr(match.teamA);
  const teamBMmr = getTeamMmr(match.teamB);
  const teamAExpected = getExpectedScore(teamAMmr, teamBMmr);
  const teamBExpected = getExpectedScore(teamBMmr, teamAMmr);
  const teamAMmrDelta = Math.round(MMR_K_FACTOR * ((winner === 'Team A' ? 1 : 0) - teamAExpected));
  const teamBMmrDelta = Math.round(MMR_K_FACTOR * ((winner === 'Team B' ? 1 : 0) - teamBExpected));

  return players.map((player) => {
    if (!selectedIds.has(player.id)) return player;

    return {
      ...player,
      games: player.games + 1,
      wins: winningIds.has(player.id) ? player.wins + 1 : player.wins,
      mmr:
        player.mmr +
        (winningIds.has(player.id) ? (winner === 'Team A' ? teamAMmrDelta : teamBMmrDelta) : 0) +
        (losingIds.has(player.id) ? (winner === 'Team A' ? teamBMmrDelta : teamAMmrDelta) : 0),
    };
  });
}
