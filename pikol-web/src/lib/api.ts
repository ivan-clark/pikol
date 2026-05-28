import type { GameHistoryItem, Match, Player, Score, ScoringEvent, TeamName } from './types';

const apiBaseUrl =
  import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3000/api`;

type ResetResponse = {
  players: Player[];
  history: GameHistoryItem[];
  currentMatch: Match | null;
};

type RecordGameResponse = {
  game: GameHistoryItem;
  players: Player[];
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const fallbackMessage = `Request failed with ${response.status}`;
    const errorBody = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(errorBody?.message)
      ? errorBody.message.join(', ')
      : errorBody?.message ?? fallbackMessage;
    throw new Error(message);
  }

  if (response.status === 204) return undefined as T;

  const responseText = await response.text();
  if (!responseText) return null as T;

  return JSON.parse(responseText) as T;
}

export const api = {
  getPlayers: () => request<Player[]>('/players'),
  addPlayer: (name: string) =>
    request<Player>('/players', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  updatePlayerAvailability: (playerId: number, available: boolean) =>
    request<Player>(`/players/${playerId}/availability`, {
      method: 'POST',
      body: JSON.stringify({ available }),
    }),
  reset: () =>
    request<ResetResponse>('/testing/reset', {
      method: 'POST',
    }),
  pickMatch: () =>
    request<Match>('/matches/pick', {
      method: 'POST',
    }),
  getCurrentMatch: () => request<Match | null>('/matches/current'),
  getHistory: () => request<GameHistoryItem[]>('/history'),
  recordGame: (body: {
    match: Match;
    score: Score;
    winner: TeamName;
    durationSeconds: number;
    scoringEvents: ScoringEvent[];
  }) =>
    request<RecordGameResponse>('/games', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  assignCourts: (playerIds: number[], courts: number) =>
    request<{ courts: Match[]; waiting: Player[] }>('/open-play/assign', {
      method: 'POST',
      body: JSON.stringify({ playerIds, courts }),
    }),
};
