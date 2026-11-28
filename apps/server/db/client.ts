import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { backupDatabase, hasData, pendingMigrations } from './backup.ts';
import { positionHash, speedOf } from '@chess/chess-core';
import { fold } from './search.ts';
import * as schema from './schema.ts';

/** All SQL in the app goes through this folder. */

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = resolve(here, 'migrations');

/** apps/server/data/chess.db unless DATABASE_PATH says otherwise. */
export function databasePath(): string {
  return process.env.DATABASE_PATH || resolve(here, '..', 'data', 'chess.db');
}

/** Opens (and creates, if needed) the database at a path, or in memory for ':memory:'. */
export function openDatabase(path: string = databasePath()): { db: Db; close: () => void } {
  if (path !== ':memory:') {
    const folder = dirname(path);
    if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
  }
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  // Case folding for search in every alphabet (db/search.ts).
  sqlite.function('fold', { deterministic: true }, (value: unknown) => (typeof value === 'string' ? fold(value) : value));
  // The game index's hash of a position key (migration 0008 fills the index with it).
  sqlite.function('position_hash', { deterministic: true, safeIntegers: true }, (key: unknown) => positionHash(String(key)));
  // How fast a game was played, from its time control (migration 0009 fills the column with it).
  sqlite.function('game_speed', { deterministic: true }, (tc: unknown, event: unknown) =>
    speedOf(typeof tc === 'string' ? tc : null, typeof event === 'string' ? event : null),
  );
  return {
    db: drizzle(sqlite, { schema }),
    close: () => {
      // Fold the WAL into the database file first, so chess.db on its own is the whole library.
      if (sqlite.open && path !== ':memory:') sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.close();
    },
  };
}

/**
 * Applies every migration not yet applied. Safe to run on each start. When a migration is about to
 * change a database that already holds a library, a backup is made first (in `backups` beside it).
 */
export function runMigrations(db: Db, options: { backupFolder?: string } = {}): void {
  const updating = hasData(db) && pendingMigrations(db, MIGRATIONS) > 0;
  if (options.backupFolder && updating) backupDatabase(db, options.backupFolder, 'before-update');
  migrate(db, { migrationsFolder: MIGRATIONS });
  // A migration can leave much of the file empty (0008 drops most position rows): give it back.
  if (updating) db.$client.exec('VACUUM');
}
