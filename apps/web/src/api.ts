import type { GameDetail, GameFilters, GameSummary, ImportReport, MoveStat } from '@chess/server/db/games.ts';
import type {
  CollectionSummary,
  PositionSetSummary,
  SavedPosition,
  SavedPositionFilters,
  SavedPositionInput,
  Settings,
  TrashItem,
  TrashKind,
} from '@chess/server/db/library.ts';

export type {
  CollectionSummary,
  GameDetail,
  GameSummary,
  ImportReport,
  MoveStat,
  PositionSetSummary,
  SavedPosition,
  SavedPositionInput,
  Settings,
  TrashItem,
};

/** A failed API call, with the server's explanation. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('The local server is not running. Start it with pnpm dev.', 0);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? `The server answered ${response.status}.`, response.status);
  return data as T;
}

function query(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null);
  return entries.length ? `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)]))}` : '';
}

export const api = {
  health: () => call<{ ok: boolean }>('GET', '/api/health'),

  games: (filters: GameFilters = {}) => call<{ total: number; games: GameSummary[] }>('GET', `/api/games${query(filters)}`),
  game: (id: string) => call<GameDetail>('GET', `/api/games/${id}`),
  createGame: (pgn: string) => call<{ id: string }>('POST', '/api/games', { pgn }),
  updateGame: (id: string, changes: { pgn?: string; notes?: string | null; tags?: string[] }) =>
    call<GameDetail>('PUT', `/api/games/${id}`, changes),
  deleteGames: (ids: string[]) => call('POST', '/api/games/delete', { ids }),
  importPgn: (pgn: string, collectionId?: string) => call<ImportReport>('POST', '/api/games/import', { pgn, collectionId }),
  importLichess: (username: string, max: number, collectionId?: string) =>
    call<ImportReport>('POST', '/api/games/import/lichess', { username, max, collectionId }),
  importChesscom: (username: string, max: number, collectionId?: string) =>
    call<ImportReport>('POST', '/api/games/import/chesscom', { username, max, collectionId }),
  gamesAt: (fen: string, limit = 30) =>
    call<{ total: number; moves: MoveStat[]; games: (GameSummary & { ply: number; nextSan: string | null })[] }>(
      'GET',
      `/api/positions/games${query({ fen, limit })}`,
    ),

  collections: () => call<CollectionSummary[]>('GET', '/api/collections'),
  createCollection: (name: string) => call<{ id: string }>('POST', '/api/collections', { name }),
  renameCollection: (id: string, name: string) => call('PUT', `/api/collections/${id}`, { name }),
  deleteCollection: (id: string) => call('DELETE', `/api/collections/${id}`),
  addToCollection: (id: string, gameIds: string[]) => call('POST', `/api/collections/${id}/games`, { gameIds }),
  removeFromCollection: (id: string, gameIds: string[]) => call('POST', `/api/collections/${id}/games/remove`, { gameIds }),

  savedPositions: (filters: SavedPositionFilters = {}) =>
    call<{ total: number; positions: SavedPosition[] }>('GET', `/api/saved-positions${query(filters)}`),
  savedPosition: (id: string) => call<SavedPosition>('GET', `/api/saved-positions/${id}`),
  savesAt: (fen: string, except?: string) =>
    call<{ id: string; title: string; createdAt: string }[]>('GET', `/api/saved-positions/at${query({ fen, except })}`),
  savePosition: (input: SavedPositionInput) => call<SavedPosition>('POST', '/api/saved-positions', input),
  updateSavedPosition: (id: string, changes: Partial<SavedPositionInput>) =>
    call<SavedPosition>('PUT', `/api/saved-positions/${id}`, changes),
  deleteSavedPosition: (id: string) => call('DELETE', `/api/saved-positions/${id}`),

  sets: () => call<PositionSetSummary[]>('GET', '/api/sets'),
  createSet: (name: string) => call<{ id: string }>('POST', '/api/sets', { name }),
  updateSet: (id: string, changes: { name?: string; description?: string }) => call('PUT', `/api/sets/${id}`, changes),
  deleteSet: (id: string) => call('DELETE', `/api/sets/${id}`),
  addToSet: (id: string, ids: string[]) => call('POST', `/api/sets/${id}/items`, { ids }),
  removeFromSet: (id: string, ids: string[]) => call('POST', `/api/sets/${id}/items/remove`, { ids }),
  reorderSet: (id: string, ids: string[]) => call('PUT', `/api/sets/${id}/order`, { ids }),

  tags: (type?: 'game' | 'saved_position' | 'concept') =>
    call<{ name: string; count: number }[]>('GET', `/api/tags${query({ type })}`),
  settings: () => call<Settings>('GET', '/api/settings'),
  updateSettings: (values: Settings) => call<Settings>('PUT', '/api/settings', values),
  trash: () => call<TrashItem[]>('GET', '/api/trash'),
  restore: (kind: TrashKind, id: string) => call('POST', '/api/trash/restore', { kind, id }),
};
