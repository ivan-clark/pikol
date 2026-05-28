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

// From four players, choose the 2v2 split that least repeats past partnerships
// and keeps the two teams closest in average MMR.
function bestPairing(four: Player[], history: GameHistoryItem[]): Match {
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
    const firstPairRepeatCount =
      getPairPlayCount(history, firstPairing[0]) + getPairPlayCount(history, firstPairing[1]);
    const secondPairRepeatCount =
      getPairPlayCount(history, secondPairing[0]) + getPairPlayCount(history, secondPairing[1]);
    const firstDifference = Math.abs(getTeamMmr(firstPairing[0]) - getTeamMmr(firstPairing[1]));
    const secondDifference = Math.abs(getTeamMmr(secondPairing[0]) - getTeamMmr(secondPairing[1]));

    return firstPairRepeatCount - secondPairRepeatCount || firstDifference - secondDifference;
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

// Open play: fill up to `courtCount` courts by pulling players off the front of an
// already-ordered queue (longest-waiting first), balancing each court's 2v2 split.
// Returns the matches placed on courts plus whoever is still waiting.
export function assignCourts(
  orderedPlayers: Player[],
  history: GameHistoryItem[],
  courtCount: number,
): { courts: Match[]; waiting: Player[] } {
  const courts: Match[] = [];
  let cursor = 0;

  while (courts.length < courtCount && orderedPlayers.length - cursor >= 4) {
    courts.push(bestPairing(orderedPlayers.slice(cursor, cursor + 4), history));
    cursor += 4;
  }

  return { courts, waiting: orderedPlayers.slice(cursor) };
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
