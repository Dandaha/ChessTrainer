import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createPositionCategory, deletePositionCategory, listPositionCategories, renamePositionCategory } from '../../db/categories.ts';
import type { Db } from '../../db/client.ts';
import {
  type GameFilters,
  gamesAtPosition,
  getGame,
  GAME_SORTS,
  exportGames,
  type ImportEvent,
  type ImportProgress,
  type ImportReport,
  importGamesInBatches,
  timeControls,
  findDuplicates,
  fillMyColor,
  listGameIds,
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
  restoreGamesToCollection,
  reorderSet,
  restore,
  restoreAll,
  emptyTrash,
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
import { SPEEDS } from '@chess/chess-core';
import { streamEvents, wantsEvents } from '../events.ts';
import { backupDatabase, listBackups } from '../../db/backup.ts';

type Query = Record<string, string | undefined>;

const num = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
const bool = (v?: string) => (v === 'true' ? true : v === 'false' ? false : undefined);

/** Phase 2: the game library, saved positions, sets, tags, settings and trash. */
export function libraryRoutes(app: FastifyInstance, db: Db, options: { backupFolder: string }): void {
  // Games ---------------------------------------------------------------------
  // The last import: the games it brought in, by its id. A library whose last import came before
  // imports had ids goes by when it started; none yet, nothing matches.
  const lastImport = (): Pick<GameFilters, 'importId' | 'since'> => {
    const settings = getSettings(db);
    if (typeof settings.lastImportId === 'string') return { importId: settings.lastImportId };
    return { since: typeof settings.lastImportAt === 'string' ? settings.lastImportAt : '9999' };
  };
  const gameFilters = (q: Query): GameFilters => ({
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
      speed: (SPEEDS as readonly string[]).includes(q.speed ?? '') ? (q.speed as GameFilters['speed']) : undefined,
      timeControl: q.timeControl || undefined,
      ...(q.lastImport ? lastImport() : {}),
      sort: (GAME_SORTS as readonly string[]).includes(q.sort ?? '') ? (q.sort as GameFilters['sort']) : undefined,
      dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
      limit: num(q.limit),
      offset: num(q.offset),
  });
  app.get('/api/games', async (req) => listGames(db, gameFilters(req.query as Query)));
  app.get('/api/games/time-controls', async () => timeControls(db));
  // Every game the filter finds, on every page: for "select all that match".
  app.get('/api/games/ids', async (req) => ({ ids: listGameIds(db, gameFilters(req.query as Query)) }));
  app.get('/api/games/duplicates', async () => findDuplicates(db));
  // The whole filter or collection as one PGN file, or the games picked by id.
  app.get('/api/games/export', async (req) => exportGames(db, gameFilters(req.query as Query)));
  app.post('/api/games/export', async (req) => exportGames(db, { ids: parseBody(bodies.ids, req.body).ids }));

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

  // An import answers with its report, or, to a browser that asks for events, streams its progress
  // first (downloading, then importing) and ends with the report.
  const importing = async (
    req: FastifyRequest,
    reply: FastifyReply,
    work: (importId: string, onProgress: (progress: ImportProgress) => void) => Promise<ImportReport>,
  ) => {
    // An import that adds games becomes "the last import" in the library: the games marked with its id.
    const importId = randomUUID();
    const remember = (report: ImportReport) => {
      if (report.imported > 0) updateSettings(db, { lastImportId: importId });
      return report;
    };
    if (!wantsEvents(req)) return remember(await work(importId, () => {}));
    await streamEvents<ImportEvent>(reply, async (emit) => {
      const report = remember(await work(importId, (progress) => emit({ type: 'progress', ...progress })));
      emit({ type: 'done', report });
    });
    return reply;
  };

  app.post('/api/games/import', async (req, reply) => {
    const body = parseBody(bodies.pgnImport, req.body);
    return importing(req, reply, (importId, onProgress) =>
      importGamesInBatches(db, body.pgn, { source: 'file', myNames: myNames(), collectionId: body.collectionId, importId }, onProgress),
    );
  });

  app.post('/api/games/import/lichess', async (req, reply) => {
    const body = parseBody(bodies.accountImport, req.body);
    return importing(req, reply, async (importId, onProgress) => {
      const pgn = await fetchLichessGames(body.username, body.max ?? 500, process.env.LICHESS_TOKEN || undefined, (games) =>
        onProgress({ phase: 'downloading', games, expected: body.max ?? 500 }),
      );
      if (body.mine) updateSettings(db, { lichessUsername: body.username.trim() });
      return importGamesInBatches(db, pgn, { source: 'lichess', myNames: myNames(), collectionId: body.collectionId, importId }, onProgress);
    });
  });

  app.post('/api/games/import/chesscom', async (req, reply) => {
    const body = parseBody(bodies.accountImport, req.body);
    return importing(req, reply, async (importId, onProgress) => {
      const pgn = await fetchChesscomGames(body.username, body.max ?? 500, (games) =>
        onProgress({ phase: 'downloading', games, expected: body.max ?? 500 }),
      );
      if (body.mine) updateSettings(db, { chesscomUsername: body.username.trim() });
      return importGamesInBatches(db, pgn, { source: 'chesscom', myNames: myNames(), collectionId: body.collectionId, importId }, onProgress);
    });
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
  app.post('/api/collections/:id/games', async (req) => ({
    ok: true,
    added: addGamesToCollection(db, (req.params as { id: string }).id, parseBody(bodies.gameIds, req.body).gameIds),
  }));
  app.post('/api/collections/:id/games/remove', async (req) => ({
    ok: true,
    removed: removeGamesFromCollection(db, (req.params as { id: string }).id, parseBody(bodies.gameIds, req.body).gameIds),
  }));
  app.post('/api/collections/:id/games/restore', async (req) => {
    restoreGamesToCollection(db, (req.params as { id: string }).id, parseBody(bodies.collectionPlaces, req.body).places);
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
  app.put('/api/settings', async (req) => {
    const changes = parseBody(bodies.settings, req.body);
    const settings = updateSettings(db, changes);
    // A name of mine set now marks the games already in the library that it played.
    if (changes.lichessUsername || changes.chesscomUsername) fillMyColor(db, myNames());
    return settings;
  });
  app.get('/api/trash', async () => listTrash(db));

  // Backups ----------------------------------------------------------------------
  app.get('/api/backups', async () => ({ folder: options.backupFolder, backups: listBackups(options.backupFolder) }));
  app.post('/api/backups', async () => {
    const backup = backupDatabase(db, options.backupFolder);
    return { backup, folder: options.backupFolder, backups: listBackups(options.backupFolder) };
  });
  app.post('/api/trash/restore-all', async () => ({ restored: restoreAll(db) }));
  app.post('/api/trash/empty', async () => ({ deleted: emptyTrash(db) }));
  app.post('/api/trash/restore', async (req) => {
    const { kind, id, ids } = parseBody(bodies.restore, req.body);
    restore(db, kind, ids ?? [id!]);
    return { ok: true };
  });
}
