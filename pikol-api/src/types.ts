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

export type RecordGameBody = {
  match: Match;
  score: Score;
  winner: TeamName;
  durationSeconds: number;
  scoringEvents: ScoringEvent[];
};

export type AssignCourtsBody = {
  playerIds: number[];
  courts: number;
  // Map of "smallerId-largerId" → number of times that pair has partnered this
  // session. Optional — when present, the assigner avoids repeating those pairs.
  sessionPairCounts?: Record<string, number>;
  // Per-player count of games played in the current session. When present, the
  // assigner enforces strict fair-games-played and only swaps within a tier of
  // ties to favour fresh partnerships.
  sessionGamesPlayed?: Record<number, number>;
};
