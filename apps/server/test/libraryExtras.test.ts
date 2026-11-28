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
