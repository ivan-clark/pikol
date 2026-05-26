import type { GameHistoryItem, Match, Player, Score, TeamName } from './types';

export const WINNING_SCORE = 11;
export const DEUCE_SCORE = 10;
export const WIN_BY_POINTS = 2;
export const STARTING_MMR = 1000;
export const MMR_K_FACTOR = 32;

export function snapshotTeam(team: Player[]) {
  return team.map((player) => ({
    id: player.id,
    name: player.name,
    mmr: player.mmr,
  }));
}

export function shufflePlayers(players: Player[]) {
  return [...players]
    .map((player) => ({ player, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ player }) => player);
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

export function getMatchPoint(score: Score): TeamName | 'Deuce' | null {
  if (getWinner(score)) return null;

  if (score.teamA >= DEUCE_SCORE && score.teamB >= DEUCE_SCORE) {
    if (score.teamA === score.teamB) return 'Deuce';
    return score.teamA > score.teamB ? 'Team A' : 'Team B';
  }

  if (score.teamA === WINNING_SCORE - 1 && score.teamB < DEUCE_SCORE) return 'Team A';
  if (score.teamB === WINNING_SCORE - 1 && score.teamA < DEUCE_SCORE) return 'Team B';

  return null;
}

export function getTeamMmr(team: Player[]) {
  return team.reduce((total, player) => total + player.mmr, 0) / team.length;
}

export function getExpectedScore(teamMmr: number, opponentMmr: number) {
  return 1 / (1 + 10 ** ((opponentMmr - teamMmr) / 400));
}

function getPlayerStrength(player: Player) {
  return player.mmr;
}

function getPairKey(players: Player[]) {
  return players
    .map((player) => player.id)
    .sort((a, b) => a - b)
    .join(':');
}

function getPairPlayCount(history: GameHistoryItem[], players: Player[]) {
  const pairKey = getPairKey(players);

  return history.filter((game) => {
    const teamAKey = game.teamA
      .map((player) => player.id)
      .sort((a, b) => a - b)
      .join(':');
    const teamBKey = game.teamB
      .map((player) => player.id)
      .sort((a, b) => a - b)
      .join(':');

    return teamAKey === pairKey || teamBKey === pairKey;
  }).length;
}

export function pickMatch(players: Player[], history: GameHistoryItem[]): Match | null {
  if (players.length < 4) return null;

  const selectedPlayers = shufflePlayers(players)
    .sort((a, b) => a.games - b.games)
    .slice(0, 4);
  const pairings = [
    [
      [selectedPlayers[0], selectedPlayers[1]],
      [selectedPlayers[2], selectedPlayers[3]],
    ],
    [
      [selectedPlayers[0], selectedPlayers[2]],
      [selectedPlayers[1], selectedPlayers[3]],
    ],
    [
      [selectedPlayers[0], selectedPlayers[3]],
      [selectedPlayers[1], selectedPlayers[2]],
    ],
  ];

  const [teamA, teamB] = pairings.sort((firstPairing, secondPairing) => {
    const firstPairRepeatCount =
      getPairPlayCount(history, firstPairing[0]) + getPairPlayCount(history, firstPairing[1]);
    const secondPairRepeatCount =
      getPairPlayCount(history, secondPairing[0]) + getPairPlayCount(history, secondPairing[1]);
    const firstDifference = Math.abs(
      firstPairing[0].reduce((total, player) => total + getPlayerStrength(player), 0) -
        firstPairing[1].reduce((total, player) => total + getPlayerStrength(player), 0),
    );
    const secondDifference = Math.abs(
      secondPairing[0].reduce((total, player) => total + getPlayerStrength(player), 0) -
        secondPairing[1].reduce((total, player) => total + getPlayerStrength(player), 0),
    );

    return firstPairRepeatCount - secondPairRepeatCount || firstDifference - secondDifference;
  })[0];

  return { teamA, teamB };
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

export function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function winRate(wins: number, games: number) {
  return games > 0 ? Math.round((wins / games) * 100) : 0;
}
