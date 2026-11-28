import type { GameDetail, GameFilters, GameSummary, ImportReport, MoveStat } from '@chess/server/db/games.ts';
import type { Color, Priority, RepEdge, RepertoireCheck } from '@chess/chess-core';
import type { RepertoireSummary } from '@chess/server/db/repertoire.ts';
import type { CardDetail, QueueSummary, TrainingStats } from '@chess/server/db/training.ts';
import type { ConceptCategory, ConceptInput, ConceptLinkTarget, ConceptPage, ConceptSummary } from '@chess/server/db/concepts.ts';
import type { CoachHistoryItem } from '@chess/server/db/coach.ts';
import type { PositionCategory } from '@chess/server/db/categories.ts';
import type { Backup } from '@chess/server/db/backup.ts';
import type { Annotations, CoachEvent, CoachMode, CoachRequest, ReviewMoment, Suggestions, Usage } from '@chess/server/coach/coach.ts';
import type { EngineStatus } from '@chess/server/src/engineService.ts';
import type { Analysis, EngineLine } from '@chess/chess-tools/score';
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

/** Settings to change; null clears one. */
export type SettingsUpdate = { [K in keyof Settings]?: Settings[K] | null };

export type {
  Backup,
  PositionCategory,
  Annotations,
  CoachEvent,
  CoachHistoryItem,
  CoachMode,
  CoachRequest,
  ReviewMoment,
  Suggestions,
  Usage,
  ConceptCategory,
  ConceptLinkTarget,
  ConceptPage,
  ConceptSummary,
  Analysis,
  CardDetail,
  EngineLine,
  EngineStatus,
  QueueSummary,
  TrainingStats,
  RepertoireSummary,
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

/** POSTs and reads the server-sent events the coach streams back. */
async function streamPost(path: string, body: unknown, onEvent: (event: CoachEvent) => void): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ApiError('The local server is not running. Start it with pnpm dev.', 0);
  }
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(data.error ?? `The server answered ${response.status}.`, response.status);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const chunk = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (chunk.startsWith('data: ')) {
        const event = JSON.parse(chunk.slice(6)) as CoachEvent;
        if (event.type === 'done' || event.type === 'error') finished = true;
        onEvent(event);
      }
      end = buffer.indexOf('\n\n');
    }
  }
  // A stream that stops without an answer or an error must not leave the panel "thinking" forever.
  if (!finished) onEvent({ type: 'error', error: 'The answer stopped before it was complete. Try again.' });
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
  importLichess: (username: string, max: number, collectionId?: string, mine = false) =>
    call<ImportReport>('POST', '/api/games/import/lichess', { username, max, collectionId, mine }),
  importChesscom: (username: string, max: number, collectionId?: string, mine = false) =>
    call<ImportReport>('POST', '/api/games/import/chesscom', { username, max, collectionId, mine }),
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

  positionCategories: () => call<PositionCategory[]>('GET', '/api/position-categories'),
  createPositionCategory: (name: string) => call<PositionCategory>('POST', '/api/position-categories', { name }),
  renamePositionCategory: (id: string, name: string) => call<PositionCategory>('PUT', `/api/position-categories/${id}`, { name }),
  deletePositionCategory: (id: string) =>
    call<{ removed: boolean; uncategorized: number }>('DELETE', `/api/position-categories/${id}`),
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
  updateSettings: (values: SettingsUpdate) => call<Settings>('PUT', '/api/settings', values),
  trash: () => call<TrashItem[]>('GET', '/api/trash'),
  /** Only the desktop app answers this; the browser version gets a 404. */
  systemInfo: () =>
    call<{ desktop: boolean; dataDir: string; databasePath: string; envFile: string; mcpConfig: unknown }>('GET', '/api/system/info'),

  repertoires: () => call<RepertoireSummary[]>('GET', '/api/repertoires'),
  createRepertoire: (name: string, color: Color) => call<{ id: string }>('POST', '/api/repertoires', { name, color }),
  renameRepertoire: (id: string, name: string) => call('PUT', `/api/repertoires/${id}`, { name }),
  deleteRepertoire: (id: string) => call('DELETE', `/api/repertoires/${id}`),
  repertoire: (id: string) => call<{ repertoire: RepertoireSummary; edges: RepEdge[]; startFen: string }>('GET', `/api/repertoires/${id}`),
  addLine: (id: string, fen: string, sans: string[]) =>
    call<{ added: number; existing: number }>('POST', `/api/repertoires/${id}/line`, { fen, sans }),
  importRepertoire: (id: string, pgn: string) =>
    call<{ added: number; existing: number; games: number; errors: { gameIndex: number; line: number; message: string }[] }>(
      'POST',
      `/api/repertoires/${id}/import`,
      { pgn },
    ),
  exportRepertoire: (id: string) => call<{ pgn: string }>('GET', `/api/repertoires/${id}/export`),
  updateRepertoireMove: (id: string, changes: { isMain?: boolean; priority?: Priority; comment?: string | null; isMyMove?: boolean }) =>
    call('PUT', `/api/repertoire-moves/${id}`, changes),
  deleteRepertoireMove: (id: string) => call<{ deleted: number }>('DELETE', `/api/repertoire-moves/${id}`),
  repertoiresAt: (fen: string) =>
    call<{ repertoire: RepertoireSummary; moves: RepEdge[]; reached: boolean }[]>('GET', `/api/repertoires/at${query({ fen })}`),
  checkGame: (pgn: string, color?: Color) =>
    call<{ repertoire: RepertoireSummary; result: RepertoireCheck; message: string }[]>('POST', '/api/repertoires/check', { pgn, color }),
  testEngine: (path: string) => call<{ name: string }>('POST', '/api/engine/test', { path }),
  engineStatus: () => call<EngineStatus>('GET', '/api/engine/status'),
  evaluate: (fen: string, depth = 18, multipv = 3) => call<Analysis>('POST', '/api/engine/evaluate', { fen, depth, multipv }),
  engineStreamUrl: (fen: string, multipv = 3) => `/api/engine/stream${query({ fen, multipv })}`,

  trainingSummary: () => call<QueueSummary>('GET', '/api/training/summary'),
  trainingQueue: (filter: { repertoireId?: string; type?: 'repertoire_move' | 'saved_position' } = {}) =>
    call<CardDetail[]>('GET', `/api/training/queue${query(filter)}`),
  review: (cardId: string, rating: 1 | 2 | 3 | 4, correct: boolean) => call('POST', '/api/training/review', { cardId, rating, correct }),
  trainingStats: () => call<TrainingStats>('GET', '/api/training/stats'),
  checkMove: (fen: string, uci: string, answer?: string | null) =>
    call<{
      san: string;
      answerMatch: boolean | null;
      engine: { best: string; bestScore: number; playedScore: number; loss: number; good: boolean } | null;
      engineError: string | null;
    }>('POST', '/api/training/check', { fen, uci, answer }),

  concepts: (filter: { q?: string; category?: ConceptCategory; tag?: string } = {}) =>
    call<ConceptSummary[]>('GET', `/api/concepts${query(filter)}`),
  concept: (id: string) => call<ConceptPage>('GET', `/api/concepts/${id}`),
  createConcept: (input: ConceptInput) => call<ConceptSummary>('POST', '/api/concepts', input),
  updateConcept: (id: string, changes: Partial<ConceptInput>) => call<ConceptPage>('PUT', `/api/concepts/${id}`, changes),
  deleteConcept: (id: string) => call('DELETE', `/api/concepts/${id}`),
  linkConcept: (id: string, targetType: ConceptLinkTarget, target: { targetId?: string; fen?: string }) =>
    call('POST', `/api/concepts/${id}/links`, { targetType, ...target }),
  unlinkConcept: (id: string, targetType: ConceptLinkTarget, targetId: string) =>
    call('POST', `/api/concepts/${id}/links/remove`, { targetType, targetId }),
  conceptsFor: (targetType: ConceptLinkTarget, targetId: string) =>
    call<ConceptSummary[]>('GET', `/api/concepts/for${query({ targetType, targetId })}`),
  conceptsAt: (fen: string) => call<ConceptSummary[]>('GET', `/api/concepts/at${query({ fen })}`),
  conceptDrill: (id: string) =>
    call<{ fen: string; title: string; answer: string | null; savedId: string | null }>('GET', `/api/concepts/${id}/drill`),

  coachStatus: () =>
    call<{
      connected: boolean;
      message: string | null;
      models: string[];
      quickModel: string;
      deepModel: string;
      month: { model: string | null; answers: number; input: number; output: number; costUsd: number }[];
    }>('GET', '/api/coach/status'),
  setCoachKey: (apiKey: string) => call('PUT', '/api/coach/key', { apiKey }),
  removeCoachKey: () => call('DELETE', '/api/coach/key'),
  coachHistory: (fen: string) => call<CoachHistoryItem[]>('GET', `/api/coach/history${query({ fen })}`),
  askCoach: (request: CoachRequest, onEvent: (event: CoachEvent) => void) => streamPost('/api/coach/ask', request, onEvent),
  reviewGame: (request: { startFen: string; moves: string[]; myColor?: 'white' | 'black' }, onEvent: (event: CoachEvent) => void) =>
    streamPost('/api/coach/review', request, onEvent),

  gaps: (id: string, maxPositions = 25, minShare = 0.05) =>
    call<{ checked: number; gaps: { fen: string; ply: number; total: number; share: number; move: { uci: string; san: string } }[] }>(
      'GET',
      `/api/repertoires/${id}/gaps${query({ maxPositions, minShare })}`,
    ),
  restore: (kind: TrashKind, id: string) => call('POST', '/api/trash/restore', { kind, id }),
  backups: () => call<{ folder: string; backups: Backup[] }>('GET', '/api/backups'),
  backUp: () => call<{ backup: Backup; folder: string; backups: Backup[] }>('POST', '/api/backups'),
};
