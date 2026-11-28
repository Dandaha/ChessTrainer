import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from './client.ts';

/**
 * Backups of the whole library: a consistent copy of the database (VACUUM INTO takes everything,
 * including writes still in the WAL file) in a backups folder next to it. They are made on request
 * (Settings), before a migration changes the database, and when the app starts if the newest is more
 * than a week old. The newest ten are kept.
 */

export interface Backup {
  name: string;
  path: string;
  bytes: number;
  createdAt: string;
}

const KEEP = 10;
const PATTERN = /^chess-\d{8}-\d{6}(-[\w-]+)?\.db$/;

/** The backups folder for a database file: `backups` beside it. */
export function backupFolderFor(databaseFile: string): string {
  return join(dirname(databaseFile), 'backups');
}

function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function listBackups(folder: string): Backup[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((name) => PATTERN.test(name))
    .map((name) => {
      const path = join(folder, name);
      const info = statSync(path);
      return { name, path, bytes: info.size, createdAt: info.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Writes a backup now and drops all but the newest ten. `reason` ends up in the file name. */
export function backupDatabase(db: Db, folder: string, reason?: string, now = new Date()): Backup {
  mkdirSync(folder, { recursive: true });
  let name = `chess-${stamp(now)}${reason ? `-${reason}` : ''}.db`;
  for (let n = 2; existsSync(join(folder, name)); n += 1) name = `chess-${stamp(now)}-${reason ?? 'copy'}${n}.db`;
  const path = join(folder, name);
  db.$client.prepare('VACUUM INTO ?').run(path);
  for (const old of listBackups(folder).slice(KEEP)) rmSync(old.path, { force: true });
  const info = statSync(path);
  return { name, path, bytes: info.size, createdAt: info.mtime.toISOString() };
}

/** A backup when the newest is older than `days`, or there is none; null when a recent one exists. */
export function backupIfDue(db: Db, folder: string, days = 7, now = new Date()): Backup | null {
  const newest = listBackups(folder)[0];
  if (newest && now.getTime() - new Date(newest.createdAt).getTime() < days * 86_400_000) return null;
  if (!hasLibrary(db)) return null;
  return backupDatabase(db, folder, 'weekly', now);
}

/** Whether there is anything of the person's in it yet: a new, empty library needs no backup. */
function hasLibrary(db: Db): boolean {
  if (!hasData(db)) return false;
  const row = db.$client
    .prepare(
      'select (select count(*) from games) + (select count(*) from saved_positions) + (select count(*) from repertoire_moves) + (select count(*) from concepts) as n',
    )
    .get() as { n: number };
  return row.n > 0;
}

/** Whether the database holds anything worth a backup (it has been migrated at least once). */
export function hasData(db: Db): boolean {
  const table = db.$client.prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  if (!table) return false;
  const row = db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
  return row.n > 0;
}

/** How many migrations in the folder this database has not had yet. */
export function pendingMigrations(db: Db, migrationsFolder: string): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
  if (!hasData(db)) return journal.entries.length;
  const row = db.$client.prepare('select count(*) as n from __drizzle_migrations').get() as { n: number };
  return Math.max(0, journal.entries.length - row.n);
}
