import type { FastifyInstance } from 'fastify';
import { createPositionCategory, deletePositionCategory, listPositionCategories, renamePositionCategory } from '../../db/categories.ts';
import type { Db } from '../../db/client.ts';
import {
  type GameFilters,
  gamesAtPosition,
  getGame,
  GAME_SORTS,
  importGamesInBatches,
  listGames,
  saveGame,
  updateGame,
} from '../../db/games.ts';
import {
  type Category,
  type SavedPositionFilters,
  type Settings,
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
import { bodies, parseBody } from '../validate.ts';
import { backupDatabase, listBackups } from '../../db/backup.ts';

type Query = Record<string, string | undefined>;

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
const bool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Phase 2: the game library, saved positions, sets, tags, settings and trash. */
export function libraryRoutes(app: FastifyInstance, db: Db, options: { backupFolder: string }): void {
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
      sort: (GAME_SORTS as readonly string[]).includes(q.sort ?? '') ? (q.sort as GameFilters['sort']) : undefined,
      dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
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
    const { pgn } = parseBody(bodies.pgn, req.body);
    return { id: saveGame(db, { pgn }) };
  });

  app.put('/api/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseBody(bodies.gameUpdate, req.body);
    if (!getGame(db, id)) return reply.code(404).send({ error: 'No such game.' });
    updateGame(db, id, body);
    return getGame(db, id);
  });

  app.post('/api/games/delete', async (req) => {
    softDelete(db, 'game', parseBody(bodies.ids, req.body).ids);
    return { ok: true };
  });

  // "My colour" comes from my own names in Settings. Importing someone else's games leaves them alone;
  // an import marked `mine` remembers the name as mine first.
  const myNames = () => {
    const settings = getSettings(db);
    return [settings.lichessUsername, settings.chesscomUsername].filter((name): name is string => typeof name === 'string' && name.trim() !== '');
  };

  app.post('/api/games/import', async (req) => {
    const body = parseBody(bodies.pgnImport, req.body);
    return importGamesInBatches(db, body.pgn, { source: 'file', myNames: myNames(), collectionId: body.collectionId });
  });

  app.post('/api/games/import/lichess', async (req) => {
    const body = parseBody(bodies.accountImport, req.body);
    const pgn = await fetchLichessGames(body.username, body.max ?? 500, process.env.LICHESS_TOKEN || undefined);
    if (body.mine) updateSettings(db, { lichessUsername: body.username.trim() });
    return importGamesInBatches(db, pgn, { source: 'lichess', myNames: myNames(), collectionId: body.collectionId });
  });

  app.post('/api/games/import/chesscom', async (req) => {
    const body = parseBody(bodies.accountImport, req.body);
    const pgn = await fetchChesscomGames(body.username, body.max ?? 500);
    if (body.mine) updateSettings(db, { chesscomUsername: body.username.trim() });
    return importGamesInBatches(db, pgn, { source: 'chesscom', myNames: myNames(), collectionId: body.collectionId });
  });

  app.get('/api/positions/games', async (req) => {
    const q = req.query as Query;
    return gamesAtPosition(db, q.fen ?? '', num(q.limit) ?? 50);
  });

  // Collections ---------------------------------------------------------------
  app.get('/api/collections', async () => listCollections(db));
  app.post('/api/collections', async (req) => ({ id: createCollection(db, parseBody(bodies.named, req.body)) }));
  app.put('/api/collections/:id', async (req) => {
    updateCollection(db, (req.params as { id: string }).id, parseBody(bodies.namedUpdate, req.body));
    return { ok: true };
  });
  app.delete('/api/collections/:id', async (req) => {
    softDelete(db, 'collection', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/collections/:id/games', async (req) => {
    addGamesToCollection(db, (req.params as { id: string }).id, parseBody(bodies.gameIds, req.body).gameIds);
    return { ok: true };
  });
  app.post('/api/collections/:id/games/remove', async (req) => {
    removeGamesFromCollection(db, (req.params as { id: string }).id, parseBody(bodies.gameIds, req.body).gameIds);
    return { ok: true };
  });

  // Position categories ------------------------------------------------------
  app.get('/api/position-categories', async () => listPositionCategories(db));
  app.post('/api/position-categories', async (req) => createPositionCategory(db, parseBody(bodies.name, req.body).name));
  app.put('/api/position-categories/:id', async (req, reply) => {
    const category = renamePositionCategory(db, (req.params as { id: string }).id, parseBody(bodies.name, req.body).name);
    return category ?? reply.code(404).send({ error: 'No such category.' });
  });
  app.delete('/api/position-categories/:id', async (req, reply) => {
    const result = deletePositionCategory(db, (req.params as { id: string }).id);
    return result.removed ? result : reply.code(404).send({ error: 'No such category.' });
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
  app.post('/api/saved-positions', async (req) => createSavedPosition(db, parseBody(bodies.savedPosition, req.body)));
  app.put('/api/saved-positions/:id', async (req, reply) => {
    const saved = updateSavedPosition(db, (req.params as { id: string }).id, parseBody(bodies.savedPositionUpdate, req.body));
    return saved ?? reply.code(404).send({ error: 'No such saved position.' });
  });
  app.delete('/api/saved-positions/:id', async (req) => {
    softDelete(db, 'saved_position', [(req.params as { id: string }).id]);
    return { ok: true };
  });

  // Position sets -------------------------------------------------------------
  app.get('/api/sets', async () => listSets(db));
  app.post('/api/sets', async (req) => ({ id: createSet(db, parseBody(bodies.named, req.body)) }));
  app.put('/api/sets/:id', async (req) => {
    updateSet(db, (req.params as { id: string }).id, parseBody(bodies.namedUpdate, req.body));
    return { ok: true };
  });
  app.delete('/api/sets/:id', async (req) => {
    softDelete(db, 'position_set', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/sets/:id/items', async (req) => {
    addToSet(db, (req.params as { id: string }).id, parseBody(bodies.ids, req.body).ids);
    return { ok: true };
  });
  app.post('/api/sets/:id/items/remove', async (req) => {
    removeFromSet(db, (req.params as { id: string }).id, parseBody(bodies.ids, req.body).ids);
    return { ok: true };
  });
  app.put('/api/sets/:id/order', async (req) => {
    reorderSet(db, (req.params as { id: string }).id, parseBody(bodies.ids, req.body).ids);
    return { ok: true };
  });

  // Tags, settings, trash -----------------------------------------------------
  app.get('/api/tags', async (req) => allTags(db, (req.query as Query).type as TagTarget | undefined));
  app.get('/api/settings', async () => getSettings(db));
  app.put('/api/settings', async (req) => updateSettings(db, parseBody(bodies.settings, req.body)));
  app.get('/api/trash', async () => listTrash(db));

  // Backups ----------------------------------------------------------------------
  app.get('/api/backups', async () => ({ folder: options.backupFolder, backups: listBackups(options.backupFolder) }));
  app.post('/api/backups', async () => {
    const backup = backupDatabase(db, options.backupFolder);
    return { backup, folder: options.backupFolder, backups: listBackups(options.backupFolder) };
  });
  app.post('/api/trash/restore', async (req) => {
    const { kind, id } = parseBody(bodies.restore, req.body);
    restore(db, kind, id);
    return { ok: true };
  });
}
