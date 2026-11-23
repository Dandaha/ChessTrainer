import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { countPositions, findOrCreatePosition, findPosition } from '../db/positions.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

describe('the database', () => {
  it('stores a position once, whatever move order or move counters reach it', () => {
    const db = freshDb();
    // 1.Nf3 Nf6 2.g3 and 1.g3 Nf6 2.Nf3, written with a stray en passant square and other counters.
    const a = findOrCreatePosition(db, 'rnbqkb1r/pppppppp/5n2/8/8/5NP1/PPPPPP1P/RNBQKB1R b KQkq - 0 2');
    const b = findOrCreatePosition(db, 'rnbqkb1r/pppppppp/5n2/8/8/5NP1/PPPPPP1P/RNBQKB1R b KQkq - 4 9');
    expect(b.id).toBe(a.id);
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(countPositions(db)).toBe(1);
    expect(findPosition(db, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeUndefined();
  });

  it('applies migrations twice without harm', () => {
    const db = freshDb();
    expect(() => runMigrations(db)).not.toThrow();
  });

  it('answers the health check', async () => {
    const app = buildApp(freshDb());
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, database: { positions: 0 } });
    await app.close();
  });
});
