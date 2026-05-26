import { formatDuration, winRate } from './game';
import type { GameHistoryItem, PlayerSnapshot } from './types';

export type InsightItem = {
  label: string;
  value: string;
  detail: string;
};

function teamMmr(team: PlayerSnapshot[]) {
  return team.reduce((total, player) => total + player.mmr, 0) / team.length;
}

function underdogMargin(game: GameHistoryItem) {
  const teamAMmr = teamMmr(game.teamA);
  const teamBMmr = teamMmr(game.teamB);
  const winnerMmr = game.winner === 'Team A' ? teamAMmr : teamBMmr;
  const loserMmr = game.winner === 'Team A' ? teamBMmr : teamAMmr;

  return loserMmr - winnerMmr;
}

function scoreDifference(game: GameHistoryItem) {
  return Math.abs(game.score.teamA - game.score.teamB);
}

function totalScore(game: GameHistoryItem) {
  return game.score.teamA + game.score.teamB;
}

function wentToDeuce(game: GameHistoryItem) {
  return game.score.teamA >= 10 && game.score.teamB >= 10;
}

function pairKey(players: PlayerSnapshot[]) {
  return players
    .map((player) => player.id)
    .sort((a, b) => a - b)
    .join(':');
}

function pairName(players: PlayerSnapshot[]) {
  return players
    .map((player) => player.name)
    .sort((a, b) => a.localeCompare(b))
    .join(' / ');
}

export function bestPairings(history: GameHistoryItem[]) {
  const pairs = new Map<string, { key: string; names: string; games: number; wins: number }>();

  history.forEach((game) => {
    [
      { players: game.teamA, won: game.winner === 'Team A' },
      { players: game.teamB, won: game.winner === 'Team B' },
    ].forEach((team) => {
      const key = pairKey(team.players);
      const currentPair = pairs.get(key) ?? {
        key,
        names: pairName(team.players),
        games: 0,
        wins: 0,
      };

      pairs.set(key, {
        ...currentPair,
        games: currentPair.games + 1,
        wins: currentPair.wins + (team.won ? 1 : 0),
      });
    });
  });

  return [...pairs.values()].sort(
    (a, b) =>
      winRate(b.wins, b.games) - winRate(a.wins, a.games) ||
      b.wins - a.wins ||
      b.games - a.games ||
      a.names.localeCompare(b.names),
  );
}

export function closestGame(history: GameHistoryItem[]) {
  return [...history].sort(
    (a, b) =>
      Number(wentToDeuce(b)) - Number(wentToDeuce(a)) ||
      scoreDifference(a) - scoreDifference(b) ||
      totalScore(b) - totalScore(a),
  )[0];
}

export function longestGame(history: GameHistoryItem[]) {
  return [...history].sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
}

export function biggestUpset(history: GameHistoryItem[]) {
  return [...history].sort((a, b) => underdogMargin(b) - underdogMargin(a))[0];
}

export function bestComeback(history: GameHistoryItem[]) {
  return history
    .map((game) => {
      const deficit = game.scoringEvents.reduce((largestDeficit, event) => {
        const winnerScore = game.winner === 'Team A' ? event.score.teamA : event.score.teamB;
        const loserScore = game.winner === 'Team A' ? event.score.teamB : event.score.teamA;
        return Math.max(largestDeficit, loserScore - winnerScore);
      }, 0);

      return { game, deficit };
    })
    .filter((item) => item.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || totalScore(b.game) - totalScore(a.game))[0];
}

export function biggestLead(history: GameHistoryItem[]) {
  return history
    .map((game) => {
      const lead = game.scoringEvents.reduce((largestLead, event) => {
        return Math.max(largestLead, Math.abs(event.score.teamA - event.score.teamB));
      }, 0);

      return { game, lead };
    })
    .filter((item) => item.lead > 0)
    .sort((a, b) => b.lead - a.lead || totalScore(b.game) - totalScore(a.game))[0];
}

export function longestWinStreaks(history: GameHistoryItem[]) {
  const current = new Map<number, { id: number; name: string; wins: number }>();
  const longest = new Map<number, { id: number; name: string; wins: number }>();

  [...history].reverse().forEach((game) => {
    const winningTeam = game.winner === 'Team A' ? game.teamA : game.teamB;
    const winningIds = new Set(winningTeam.map((player) => player.id));

    [...game.teamA, ...game.teamB].forEach((player) => {
      if (winningIds.has(player.id)) {
        const next = {
          id: player.id,
          name: player.name,
          wins: (current.get(player.id)?.wins ?? 0) + 1,
        };
        current.set(player.id, next);
        if ((longest.get(player.id)?.wins ?? 0) < next.wins) longest.set(player.id, next);
      } else {
        current.set(player.id, { id: player.id, name: player.name, wins: 0 });
      }
    });
  });

  return [...longest.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
}

export function gameLabel(game: GameHistoryItem) {
  return `${game.teamA.map((player) => player.name).join(' / ')} vs ${game.teamB
    .map((player) => player.name)
    .join(' / ')}`;
}

export function gameScore(game: GameHistoryItem) {
  return `${game.score.teamA}-${game.score.teamB}`;
}

export function gameDuration(game: GameHistoryItem) {
  return formatDuration(game.durationSeconds);
}

export { scoreDifference, underdogMargin, wentToDeuce };
