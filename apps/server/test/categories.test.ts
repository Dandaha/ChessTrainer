import { describe, expect, it } from 'vitest';
import {
  createPositionCategory,
  deletePositionCategory,
  listPositionCategories,
  renamePositionCategory,
} from '../db/categories.ts';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createSavedPosition, getSavedPosition, listSavedPositions, softDelete, updateSavedPosition } from '../db/library.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
const names = (db: ReturnType<typeof freshDb>) => listPositionCategories(db).map((c) => c.name);

describe('position categories', () => {
  it('starts with the six that used to be built in, in their old order', () => {
    expect(names(freshDb())).toEqual(['Tactic', 'Strategy', 'Endgame', 'Opening', 'Calculation', 'Defense']);
  });

  it('adds custom categories at the end, once regardless of case', () => {
    const db = freshDb();
    createPositionCategory(db, '  Pawn   structures ');
    expect(names(db).at(-1)).toBe('Pawn structures');
    expect(() => createPositionCategory(db, 'pawn structures')).toThrow('already a category called “Pawn structures”');
    expect(() => createPositionCategory(db, '   ')).toThrow('needs a name');
  });

  it('files a save under the stored name, and adds a category a save names for the first time', () => {
    const db = freshDb();
    expect(createSavedPosition(db, { fen: FEN, title: 'Fork', category: 'tactic' }).category).toBe('Tactic');
    const saved = createSavedPosition(db, { fen: FEN, title: 'Knight vs bishop', category: 'Minor pieces' });
    expect(saved.category).toBe('Minor pieces');
    expect(listPositionCategories(db).find((c) => c.name === 'Minor pieces')?.count).toBe(1);
    expect(updateSavedPosition(db, saved.id, { category: null })?.category).toBeNull();
    expect(listSavedPositions(db, { category: 'TACTIC' }).total).toBe(1);
  });

  it('renames a category on its saves, and removing one leaves its saves uncategorised', () => {
    const db = freshDb();
    const first = createSavedPosition(db, { fen: FEN, title: 'One', category: 'Endgame' });
    const second = createSavedPosition(db, { fen: FEN, title: 'Two', category: 'Endgame' });
    softDelete(db, 'saved_position', [second.id]);
    const endgame = listPositionCategories(db).find((c) => c.name === 'Endgame')!;
    expect(endgame.count).toBe(1);

    expect(renamePositionCategory(db, endgame.id, 'Endgames')?.name).toBe('Endgames');
    expect(getSavedPosition(db, first.id)?.category).toBe('Endgames');
    expect(() => renamePositionCategory(db, endgame.id, 'tactic')).toThrow('already a category called “Tactic”');
    // Changing only the case of its own name is fine.
    expect(renamePositionCategory(db, endgame.id, 'endgames')?.name).toBe('endgames');

    expect(deletePositionCategory(db, endgame.id)).toEqual({ removed: true, uncategorized: 1 });
    expect(getSavedPosition(db, first.id)?.category).toBeNull();
    expect(names(db)).not.toContain('endgames');
  });

  it('answers over the API, with a 400 for a name already taken', async () => {
    const app = buildApp(freshDb());
    const created = await app.inject({ method: 'POST', url: '/api/position-categories', payload: { name: 'Prophylaxis' } });
    expect(created.json()).toMatchObject({ name: 'Prophylaxis', count: 0 });
    const again = await app.inject({ method: 'POST', url: '/api/position-categories', payload: { name: 'prophylaxis' } });
    expect(again.statusCode).toBe(400);
    expect(again.json().error).toContain('already a category');
    const id = created.json().id as string;
    expect((await app.inject({ method: 'PUT', url: `/api/position-categories/${id}`, payload: { name: 'Prevention' } })).json().name).toBe('Prevention');
    expect((await app.inject({ method: 'DELETE', url: `/api/position-categories/${id}` })).json()).toEqual({ removed: true, uncategorized: 0 });
    expect((await app.inject({ method: 'DELETE', url: `/api/position-categories/${id}` })).statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/position-categories' });
    expect(list.json()).toHaveLength(6);
  });
});
