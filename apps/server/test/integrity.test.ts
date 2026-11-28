import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createConcept, linkConcept } from '../db/concepts.ts';
import { importGames, listGames } from '../db/games.ts';
import { createSavedPosition, createSet, getSavedPosition, purgeTrash, softDelete } from '../db/library.ts';
import { conceptLinks, trainingCards } from '../db/schema.ts';
import { syncCards } from '../db/training.ts';
import { buildApp } from '../src/app.ts';

/** Changes that touch several tables happen whole or not at all, and the purge leaves nothing behind. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('updates', () => {
  it('leave a saved position untouched when one part of the change is impossible', async () => {
    const db = freshDb();
    const app = buildApp(db);
    const setId = createSet(db, { name: 'Lesson' });
    const saved = createSavedPosition(db, { fen: START, title: 'Start', tags: ['opening'], setIds: [setId] });
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/saved-positions/${saved.id}`,
      payload: { title: 'Changed', tags: ['other'], setIds: [setId, '00000000-0000-0000-0000-000000000000'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('No such position set.');
    expect(getSavedPosition(db, saved.id)).toMatchObject({ title: 'Start', tags: ['opening'], setIds: [setId] });
  });

  it('leave a game untouched when its new PGN does not read', async () => {
    const db = freshDb();
    const app = buildApp(db);
    const [id] = importGames(db, '[White "A"]\n[Black "B"]\n\n1. e4 e5 *', { source: 'file' }).gameIds;
    const bad = await app.inject({ method: 'PUT', url: `/api/games/${id}`, payload: { pgn: '1. e4 e5 2. Ke3 *', notes: 'New notes' } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/api/games/${id}` })).json()).toMatchObject({ notes: null });
    const good = await app.inject({ method: 'PUT', url: `/api/games/${id}`, payload: { pgn: '[White "A"]\n[Black "B"]\n\n1. d4 d5 *', notes: 'Queen pawn', tags: ['qgd'] } });
    expect(good.json()).toMatchObject({ notes: 'Queen pawn', tags: ['qgd'] });
    expect(listGames(db, { fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2' }).total).toBe(1);
  });
});

describe('the 30-day purge', () => {
  it('also removes the concept links and training cards of what it deletes', () => {
    const db = freshDb();
    const [gameId] = importGames(db, '[White "A"]\n[Black "B"]\n\n1. e4 e5 *', { source: 'file' }).gameIds;
    const saved = createSavedPosition(db, { fen: START, title: 'Start', inTraining: true });
    syncCards(db);
    const concept = createConcept(db, { title: 'Centre control' });
    linkConcept(db, concept.id, 'game', { id: gameId });
    linkConcept(db, concept.id, 'saved_position', { id: saved.id });
    expect(db.select().from(trainingCards).where(eq(trainingCards.targetId, saved.id)).all()).toHaveLength(1);

    softDelete(db, 'game', [gameId!]);
    softDelete(db, 'saved_position', [saved.id]);
    purgeTrash(db, -1);
    expect(db.select().from(conceptLinks).all()).toEqual([]);
    expect(db.select().from(trainingCards).where(eq(trainingCards.targetId, saved.id)).all()).toEqual([]);
  });
});
