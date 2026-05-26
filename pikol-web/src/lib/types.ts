export type TeamName = 'Team A' | 'Team B';

export type Player = {
  id: number;
  name: string;
  games: number;
  wins: number;
  mmr: number;
  available: boolean;
};

export type PlayerSnapshot = {
  id: number;
  name: string;
  mmr: number;
};

export type Score = {
  teamA: number;
  teamB: number;
};

export type ScoringEvent = {
  team: TeamName;
  score: Score;
  elapsedSeconds: number;
};

export type Match = {
  teamA: Player[];
  teamB: Player[];
};

export type GameHistoryItem = {
  id: number;
  playedAt: number;
  teamA: PlayerSnapshot[];
  teamB: PlayerSnapshot[];
  score: Score;
  winner: TeamName;
  durationSeconds: number;
  scoringEvents: ScoringEvent[];
};
