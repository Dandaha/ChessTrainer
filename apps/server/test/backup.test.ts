import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { backupDatabase, backupIfDue, listBackups } from '../db/backup.ts';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createSavedPosition, listSavedPositions } from '../db/library.ts';
import { buildApp } from '../src/app.ts';

/** The library can be backed up whole, and is, before an update changes it and once a week. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const temp = () => mkdtempSync(join(tmpdir(), 'chess-backup-'));

function library(folder: string) {
  const opened = openDatabase(join(folder, 'chess.db'));
  runMigrations(opened.db);
  createSavedPosition(opened.db, { fen: START, title: 'Start' });
  return opened;
}

describe('backups', () => {
  it('hold the whole library, and only the newest ten are kept', () => {
    const folder = temp();
    const { db, close } = library(folder);
    const backups = join(folder, 'backups');
    for (let i = 0; i < 12; i += 1) backupDatabase(db, backups, undefined, new Date(2026, 10, 1, 10, 0, i));
    close();
    const kept = listBackups(backups);
    expect(kept).toHaveLength(10);
    expect(kept[0]!.name).toBe('chess-20261101-100011.db');
    const copy = openDatabase(kept[0]!.path);
    expect(listSavedPositions(copy.db).positions.map((p) => p.title)).toEqual(['Start']);
    copy.close();
  });

  it('are made before a migration changes a library, and weekly when none is recent', () => {
    const folder = temp();
    const { db, close } = library(folder);
    const backups = join(folder, 'backups');
    // Pretend the last migration has not run yet.
    db.$client.exec('delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations); drop table position_categories;');
    runMigrations(db, { backupFolder: backups });
    expect(listBackups(backups).map((b) => b.name)).toEqual([expect.stringMatching(/-before-update\.db$/)]);
    // Nothing pending: no second backup.
    runMigrations(db, { backupFolder: backups });
    expect(listBackups(backups)).toHaveLength(1);

    expect(backupIfDue(db, backups)).toBeNull();
    const nextWeek = new Date(Date.now() + 8 * 86_400_000);
    expect(backupIfDue(db, backups, 7, nextWeek)?.name).toMatch(/-weekly\.db$/);
    close();
  });

  it('are not made weekly for a library with nothing in it yet', () => {
    const folder = temp();
    const { db, close } = openDatabase(join(folder, 'chess.db'));
    runMigrations(db);
    expect(backupIfDue(db, join(folder, 'backups'))).toBeNull();
    close();
  });

  it('leave chess.db complete on its own once the app has closed', () => {
    const folder = temp();
    const { close } = library(folder);
    close();
    const wal = join(folder, 'chess.db-wal');
    expect(!existsSync(wal) || statSync(wal).size === 0).toBe(true);
    const alone = join(temp(), 'copy.db');
    copyFileSync(join(folder, 'chess.db'), alone);
    const titles = new Database(alone).prepare('select title from saved_positions').all();
    expect(titles).toEqual([{ title: 'Start' }]);
  });

  it('can be made from Settings through the API', async () => {
    const folder = temp();
    const { db, close } = library(folder);
    const app = buildApp(db, undefined, undefined, { backupFolder: join(folder, 'backups') });
    const made = (await app.inject({ method: 'POST', url: '/api/backups' })).json();
    expect(made.backups).toHaveLength(1);
    expect(made.backup.bytes).toBeGreaterThan(0);
    expect((await app.inject({ method: 'GET', url: '/api/backups' })).json().backups).toHaveLength(1);
    await app.close();
    close();
  });
});
