import { winRate } from './game.logic';
import type { GameHistoryItem, Player, PlayerSnapshot } from './types';

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

export function buildInsights(players: Player[], history: GameHistoryItem[]) {
  const rankedPlayers = [...players].sort((a, b) => b.mmr - a.mmr || b.wins - a.wins || a.name.localeCompare(b.name));
  const bestWinRatePlayers = [...players]
    .filter((player) => player.games > 0)
    .sort((a, b) => winRate(b.wins, b.games) - winRate(a.wins, a.games) || b.wins - a.wins || b.games - a.games)
    .slice(0, 3);
  const closestGame = [...history].sort(
    (a, b) =>
      Number(wentToDeuce(b)) - Number(wentToDeuce(a)) ||
      scoreDifference(a) - scoreDifference(b) ||
      totalScore(b) - totalScore(a),
  )[0];
  const longestGame = [...history].sort((a, b) => b.durationSeconds - a.durationSeconds)[0];
  const comeback = history
    .map((game) => ({
      game,
      deficit: game.scoringEvents.reduce((largestDeficit, event) => {
        const winnerScore = game.winner === 'Team A' ? event.score.teamA : event.score.teamB;
        const loserScore = game.winner === 'Team A' ? event.score.teamB : event.score.teamA;
        return Math.max(largestDeficit, loserScore - winnerScore);
      }, 0),
    }))
    .filter((item) => item.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || totalScore(b.game) - totalScore(a.game))[0];
  const lead = history
    .map((game) => ({
      game,
      lead: game.scoringEvents.reduce((largestLead, event) => {
        return Math.max(largestLead, Math.abs(event.score.teamA - event.score.teamB));
      }, 0),
    }))
    .filter((item) => item.lead > 0)
    .sort((a, b) => b.lead - a.lead || totalScore(b.game) - totalScore(a.game))[0];
  const upset = [...history].sort((a, b) => underdogMargin(b) - underdogMargin(a))[0];

  return {
    topMmr: rankedPlayers.slice(0, 3),
    bestWinRate: bestWinRatePlayers,
    bestPairings: bestPairings(history).slice(0, 3),
    mostActive: [...players].sort((a, b) => b.games - a.games).slice(0, 3),
    closestGame: closestGame ?? null,
    longestGame: longestGame ?? null,
    bestComeback: comeback ?? null,
    biggestLead: lead ?? null,
    biggestUpset: upset && underdogMargin(upset) > 0 ? { game: upset, mmrGap: Math.round(underdogMargin(upset)) } : null,
  };
}
