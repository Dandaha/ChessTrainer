import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { START_FEN, positionKey } from '@chess/chess-core';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { gamesAtPosition, importGames, listGames } from '../db/games.ts';
import { createSavedPosition } from '../db/library.ts';

/** The game index keeps a 64-bit hash per position, not a row in positions (migration 0008). */

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const AFTER_E4_E5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
const count = (db: ReturnType<typeof openDatabase>['db'], table: string) =>
  (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

describe('the game index', () => {
  it('finds games by position without a position row for each of their moves', () => {
    const { db } = openDatabase(':memory:');
    runMigrations(db);
    importGames(db, '[White "A"]\n\n1. e4 e5 2. Nf3 *\n\n[White "B"]\n\n1. e4 e5 2. Bc4 *\n', { source: 'file' });
    expect(count(db, 'positions')).toBe(0);
    expect(count(db, 'game_positions')).toBe(8);
    expect(gamesAtPosition(db, AFTER_E4_E5).moves.map((m) => m.san).sort()).toEqual(['Bc4', 'Nf3']);
    // A position saved later is the same position to the index.
    createSavedPosition(db, { fen: AFTER_E4_E5, title: 'Open game' });
    expect(listGames(db, { fen: AFTER_E4_E5 }).total).toBe(2);
  });

  it('moves a library from position rows to hashes, keeping the rows something points at', () => {
    // A database as it was before migration 0008, with one game indexed the old way.
    const folder = mkdtempSync(join(tmpdir(), 'chess-index-'));
    const before = join(folder, 'migrations');
    cpSync(MIGRATIONS, before, { recursive: true });
    const journalFile = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0008_'));
    for (const e of journal.entries.slice(at)) rmSync(join(before, `${e.tag}.sql`));
    writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

    const { db, close } = openDatabase(join(folder, 'chess.db'));
    migrate(db, { migrationsFolder: before });
    const sqlite = db.$client;
    const gameId = randomUUID();
    sqlite.prepare("insert into games (id, pgn, source, created_at, updated_at) values (?, ?, 'file', '2026-01-01', '2026-01-01')").run(gameId, '1. e4 e5 *');
    const ids: string[] = [];
    for (const [ply, fen, next] of [
      [0, START_FEN, 'e4'],
      [1, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'e5'],
      [2, AFTER_E4_E5, null],
    ] as const) {
      const id = randomUUID();
      ids.push(id);
      sqlite.prepare("insert into positions (id, fen_key, full_fen, created_at) values (?, ?, ?, '2026-01-01')").run(id, positionKey(fen), fen);
      sqlite.prepare('insert into game_positions (game_id, ply, position_id, next_san) values (?, ?, ?, ?)').run(gameId, ply, id, next);
    }
    // The last position is also a saved position, which points at its row.
    sqlite
      .prepare("insert into saved_positions (id, position_id, fen, title, side_to_solve, created_at, updated_at) values (?, ?, ?, 'Kept', 'white', '2026-01-01', '2026-01-01')")
      .run(randomUUID(), ids[2], AFTER_E4_E5);

    runMigrations(db, { backupFolder: join(folder, 'backups') });
    expect(gamesAtPosition(db, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1').moves).toMatchObject([{ san: 'e5', games: 1 }]);
    expect(listGames(db, { fen: AFTER_E4_E5 }).total).toBe(1);
    expect(sqlite.prepare('select id from positions').all()).toEqual([{ id: ids[2] }]);
    close();
  });
});
