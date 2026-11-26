import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import {
  type GameFilters,
  gamesAtPosition,
  getGame,
  importGames,
  listGames,
  saveGame,
  updateGameMeta,
} from '../../db/games.ts';
import {
  type Category,
  type SavedPositionFilters,
  type SavedPositionInput,
  type Settings,
  type TrashKind,
  addGamesToCollection,
  addToSet,
  createCollection,
  createSavedPosition,
  createSet,
  getSavedPosition,
  getSettings,
  listCollections,
  listSavedPositions,
  listSets,
  listTrash,
  removeFromSet,
  removeGamesFromCollection,
  reorderSet,
  restore,
  savesOfPosition,
  softDelete,
  updateCollection,
  updateSavedPosition,
  updateSet,
  updateSettings,
} from '../../db/library.ts';
import { type TagTarget, allTags } from '../../db/tags.ts';
import { fetchChesscomGames, fetchLichessGames } from '../importers.ts';

type Query = Record<string, string | undefined>;

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
const bool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Phase 2: the game library, saved positions, sets, tags, settings and trash. */
export function libraryRoutes(app: FastifyInstance, db: Db): void {
  // Games ---------------------------------------------------------------------
  app.get('/api/games', async (req) => {
    const q = req.query as Query;
    const filters: GameFilters = {
      q: q.q,
      player: q.player,
      opening: q.opening,
      result: q.result,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      tag: q.tag,
      collectionId: q.collectionId,
      fen: q.fen,
      myColor: q.myColor as GameFilters['myColor'],
      source: q.source as GameFilters['source'],
      sort: q.sort as GameFilters['sort'],
      limit: num(q.limit),
      offset: num(q.offset),
    };
    return listGames(db, filters);
  });

  app.get('/api/games/:id', async (req, reply) => {
    const game = getGame(db, (req.params as { id: string }).id);
    return game ?? reply.code(404).send({ error: 'No such game.' });
  });

  app.post('/api/games', async (req) => {
    const { pgn } = req.body as { pgn: string };
    return { id: saveGame(db, { pgn }) };
  });

  app.put('/api/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { pgn?: string; notes?: string | null; tags?: string[]; myColor?: 'white' | 'black' | null };
    if (!getGame(db, id)) return reply.code(404).send({ error: 'No such game.' });
    if (body.pgn) saveGame(db, { id, pgn: body.pgn });
    updateGameMeta(db, id, body);
    return getGame(db, id);
  });

  app.post('/api/games/delete', async (req) => {
    softDelete(db, 'game', (req.body as { ids: string[] }).ids);
    return { ok: true };
  });

  app.post('/api/games/import', async (req) => {
    const body = req.body as { pgn: string; collectionId?: string };
    return importGames(db, body.pgn, { source: 'file', collectionId: body.collectionId });
  });

  app.post('/api/games/import/lichess', async (req) => {
    const body = req.body as { username: string; max?: number; collectionId?: string };
    const pgn = await fetchLichessGames(body.username, body.max ?? 500, process.env.LICHESS_TOKEN || undefined);
    updateSettings(db, { lichessUsername: body.username.trim() });
    return importGames(db, pgn, { source: 'lichess', username: body.username, collectionId: body.collectionId });
  });

  app.post('/api/games/import/chesscom', async (req) => {
    const body = req.body as { username: string; max?: number; collectionId?: string };
    const pgn = await fetchChesscomGames(body.username, body.max ?? 500);
    updateSettings(db, { chesscomUsername: body.username.trim() });
    return importGames(db, pgn, { source: 'chesscom', username: body.username, collectionId: body.collectionId });
  });

  app.get('/api/positions/games', async (req) => {
    const q = req.query as Query;
    return gamesAtPosition(db, q.fen ?? '', num(q.limit) ?? 50);
  });

  // Collections ---------------------------------------------------------------
  app.get('/api/collections', async () => listCollections(db));
  app.post('/api/collections', async (req) => ({ id: createCollection(db, req.body as { name: string }) }));
  app.put('/api/collections/:id', async (req) => {
    updateCollection(db, (req.params as { id: string }).id, req.body as { name?: string; description?: string });
    return { ok: true };
  });
  app.delete('/api/collections/:id', async (req) => {
    softDelete(db, 'collection', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/collections/:id/games', async (req) => {
    addGamesToCollection(db, (req.params as { id: string }).id, (req.body as { gameIds: string[] }).gameIds);
    return { ok: true };
  });
  app.post('/api/collections/:id/games/remove', async (req) => {
    removeGamesFromCollection(db, (req.params as { id: string }).id, (req.body as { gameIds: string[] }).gameIds);
    return { ok: true };
  });

  // Saved positions -----------------------------------------------------------
  app.get('/api/saved-positions', async (req) => {
    const q = req.query as Query;
    const filters: SavedPositionFilters = {
      q: q.q,
      category: q.category as Category | undefined,
      tag: q.tag,
      setId: q.setId,
      inTraining: bool(q.inTraining),
      source: q.source as SavedPositionFilters['source'],
      fen: q.fen,
      since: q.since,
      limit: num(q.limit),
      offset: num(q.offset),
    };
    return listSavedPositions(db, filters);
  });
  app.get('/api/saved-positions/at', async (req) => {
    const q = req.query as Query;
    return savesOfPosition(db, q.fen ?? '', q.except);
  });
  app.get('/api/saved-positions/:id', async (req, reply) => {
    const saved = getSavedPosition(db, (req.params as { id: string }).id);
    return saved ?? reply.code(404).send({ error: 'No such saved position.' });
  });
  app.post('/api/saved-positions', async (req) => createSavedPosition(db, req.body as SavedPositionInput));
  app.put('/api/saved-positions/:id', async (req, reply) => {
    const saved = updateSavedPosition(db, (req.params as { id: string }).id, req.body as Partial<SavedPositionInput>);
    return saved ?? reply.code(404).send({ error: 'No such saved position.' });
  });
  app.delete('/api/saved-positions/:id', async (req) => {
    softDelete(db, 'saved_position', [(req.params as { id: string }).id]);
    return { ok: true };
  });

  // Position sets -------------------------------------------------------------
  app.get('/api/sets', async () => listSets(db));
  app.post('/api/sets', async (req) => ({ id: createSet(db, req.body as { name: string; description?: string }) }));
  app.put('/api/sets/:id', async (req) => {
    updateSet(db, (req.params as { id: string }).id, req.body as { name?: string; description?: string });
    return { ok: true };
  });
  app.delete('/api/sets/:id', async (req) => {
    softDelete(db, 'position_set', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/sets/:id/items', async (req) => {
    addToSet(db, (req.params as { id: string }).id, (req.body as { ids: string[] }).ids);
    return { ok: true };
  });
  app.post('/api/sets/:id/items/remove', async (req) => {
    removeFromSet(db, (req.params as { id: string }).id, (req.body as { ids: string[] }).ids);
    return { ok: true };
  });
  app.put('/api/sets/:id/order', async (req) => {
    reorderSet(db, (req.params as { id: string }).id, (req.body as { ids: string[] }).ids);
    return { ok: true };
  });

  // Tags, settings, trash -----------------------------------------------------
  app.get('/api/tags', async (req) => allTags(db, (req.query as Query).type as TagTarget | undefined));
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => updateSettings(db, req.body as Settings));
  app.get('/api/trash', async () => listTrash(db));
  app.post('/api/trash/restore', async (req) => {
    const { kind, id } = req.body as { kind: TrashKind; id: string };
    restore(db, kind, id);
    return { ok: true };
  });
}
