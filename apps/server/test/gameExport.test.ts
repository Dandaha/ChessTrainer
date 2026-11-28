import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { exportGames, importGames, listGames } from '../db/games.ts';

/** Exports take the whole filter or collection, not one page, and import back with nothing lost. */

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const many = (n: number) =>
  Array.from({ length: n }, (_, i) => `[White "P${String(i).padStart(2, '0')}"]\n[Black "Каспаров"]\n[Date "2026.01.${String((i % 28) + 1).padStart(2, '0')}"]\n\n1. e4 { idea ${i} } (1. d4 d5) 1... e5 *\n`).join('\n');

describe('exporting games', () => {
  it('takes every page of a filter, in the order the list shows', () => {
    const db = freshDb();
    importGames(db, many(60), { source: 'file' });
    const all = exportGames(db, { sort: 'white', dir: 'asc' });
    expect(all.count).toBe(60);
    expect([...all.pgn.matchAll(/\[White "(P\d\d)"\]/g)].map((m) => m[1]).slice(0, 3)).toEqual(['P00', 'P01', 'P02']);
    expect(exportGames(db, { player: 'P05' }).count).toBe(1);
  });

  it('exports chosen games in the order chosen', () => {
    const db = freshDb();
    const { gameIds } = importGames(db, many(3), { source: 'file' });
    const { pgn } = exportGames(db, { ids: [gameIds[2]!, gameIds[0]!] });
    expect([...pgn.matchAll(/\[White "(P\d\d)"\]/g)].map((m) => m[1])).toEqual(['P02', 'P00']);
  });

  it('imports back whole: comments, variations and names', () => {
    const db = freshDb();
    importGames(db, many(5), { source: 'file' });
    const copy = freshDb();
    const report = importGames(copy, exportGames(db).pgn, { source: 'file' });
    expect(report).toMatchObject({ imported: 5, errors: [] });
    expect(exportGames(copy, { sort: 'white', dir: 'asc' }).pgn).toBe(exportGames(db, { sort: 'white', dir: 'asc' }).pgn);
    expect(listGames(copy, { player: 'каспаров' }).total).toBe(5);
  });
});
