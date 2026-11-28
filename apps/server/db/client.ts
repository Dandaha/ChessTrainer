import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  return { db: drizzle(sqlite, { schema }), close: () => sqlite.close() };
}

/** Applies every migration not yet applied. Safe to run on each start. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder: MIGRATIONS });
}
