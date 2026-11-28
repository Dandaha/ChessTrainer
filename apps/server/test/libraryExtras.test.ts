import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createSavedPosition, emptyTrash, listTrash, restoreAll, softDelete } from '../db/library.ts';
import { importGames, listGames } from '../db/games.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const game = (white: string) => `[White "${white}"]\n[Black "X"]\n\n1. e4 *\n`;

describe('the last import', () => {
  it('lists the games of the last import that added any', async () => {
    const app = buildApp(freshDb());
    const post = (pgn: string) => app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn } });
    await post(game('First'));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await post(`${game('Second')}\n${game('Third')}`);
    // An import of games already there adds nothing and is not "the last import".
    await post(game('First'));
    const last = (await app.inject({ method: 'GET', url: '/api/games?lastImport=1' })).json();
    expect(last.games.map((g: { white: string }) => g.white).sort()).toEqual(['Second', 'Third']);
    await app.close();
  });

  it('holds exactly the games the import brought in or back, not games saved later from the board', async () => {
    const app = buildApp(freshDb());
    const post = (pgn: string) => app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn } });
    const { gameIds } = (await post(game('Trashed'))).json();
    await app.inject({ method: 'POST', url: '/api/games/delete', payload: { ids: gameIds } });
    await post(game('Other'));
    // Back from the trash by importing it again: that is the last import now, though the game is old.
    expect((await post(game('Trashed'))).json().imported).toBe(1);
    await app.inject({ method: 'POST', url: '/api/games', payload: { pgn: game('From the board') } });
    const last = (await app.inject({ method: 'GET', url: '/api/games?lastImport=1' })).json();
    expect(last.games.map((g: { white: string }) => g.white)).toEqual(['Trashed']);
    await app.close();
  });

  it('shows nothing before any import', async () => {
    const app = buildApp(freshDb());
    expect((await app.inject({ method: 'GET', url: '/api/games?lastImport=1' })).json().total).toBe(0);
    await app.close();
  });
});

describe('the whole trash at once', () => {
  it('restores everything, or deletes everything for good', () => {
    const db = freshDb();
    importGames(db, `${game('A')}\n${game('B')}`, { source: 'file' });
    const saved = createSavedPosition(db, { fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', title: 'e4' });
    softDelete(db, 'game', listGames(db).games.map((g) => g.id));
    softDelete(db, 'saved_position', [saved.id]);
    expect(listTrash(db)).toHaveLength(3);
    expect(restoreAll(db)).toBe(3);
    expect(listTrash(db)).toHaveLength(0);
    expect(listGames(db).total).toBe(2);
    softDelete(db, 'game', listGames(db).games.map((g) => g.id));
    expect(emptyTrash(db)).toBeGreaterThanOrEqual(2);
    expect(listTrash(db)).toHaveLength(0);
    expect(listGames(db).total).toBe(0);
  });
});

describe('names and dates', () => {
  it('renames a collection back from the trash when its name was taken meanwhile', async () => {
    const db = freshDb();
    const { createCollection, listCollections, restore } = await import('../db/library.ts');
    const old = createCollection(db, { name: 'Alpha' });
    softDelete(db, 'collection', [old]);
    createCollection(db, { name: 'alpha' });
    restore(db, 'collection', old);
    expect(listCollections(db).map((c) => c.name).sort()).toEqual(['Alpha (2)', 'alpha']);
  });

  it('counts a game with an unknown month and day in the year’s ranges', () => {
    const db = freshDb();
    importGames(db, '[White "Partial"]\n[Date "2024.??.??"]\n\n1. e4 *\n\n[White "Later"]\n[Date "2025.??.??"]\n\n1. d4 *\n', { source: 'file' });
    const whites = (f: object) => listGames(db, f).games.map((g) => g.white).sort();
    expect(whites({ dateFrom: '2024-01-01', dateTo: '2024-12-31' })).toEqual(['Partial']);
    expect(whites({ dateFrom: '2024-06-01', dateTo: '2024-12-31' })).toEqual(['Partial']);
    expect(whites({ dateFrom: '2025-02-01' })).toEqual(['Later']);
    expect(whites({ dateTo: '2023-12-31' })).toEqual([]);
  });
});

describe('my games and collections', () => {
  it('marks my colour on games already in the library when my name is set later', async () => {
    const app = buildApp(freshDb());
    await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: `${game('DaveX')}\n[White "Other"]\n[Black "davex"]\n\n1. d4 *\n` } });
    await app.inject({ method: 'PUT', url: '/api/settings', payload: { lichessUsername: 'DaveX' } });
    const mine = (color: string) => app.inject({ method: 'GET', url: `/api/games?myColor=${color}` }).then((r) => r.json().total);
    expect([await mine('white'), await mine('black')]).toEqual([1, 1]);
    await app.close();
  });

  it('says how many games were new to a collection, and lists every game a filter finds', async () => {
    const app = buildApp(freshDb());
    const { gameIds } = (await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: `${game('A')}\n${game('B')}\n${game('C')}` } })).json();
    const { id } = (await app.inject({ method: 'POST', url: '/api/collections', payload: { name: 'Mine' } })).json();
    const add = (ids: string[]) => app.inject({ method: 'POST', url: `/api/collections/${id}/games`, payload: { gameIds: ids } }).then((r) => r.json().added);
    expect(await add(gameIds.slice(0, 2))).toBe(2);
    expect(await add(gameIds)).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/api/games/ids?limit=1' })).json().ids).toHaveLength(3);
    await app.close();
  });

  it('orders names as people count: 2 before 10', async () => {
    const db = freshDb();
    const { createCollection, listCollections } = await import('../db/library.ts');
    for (const name of ['Lesson 10', 'lesson 2', 'Écoles', 'Beta']) createCollection(db, { name });
    expect(listCollections(db).map((c) => c.name)).toEqual(['Beta', 'Écoles', 'lesson 2', 'Lesson 10']);
  });
});
