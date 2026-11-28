import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { buildApp } from '../src/app.ts';

/** The installed app keeps its warnings and server errors in server.log, which never grows past about 1 MB. */

function app(logFile: string) {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return buildApp(db, undefined, undefined, { logFile });
}

describe('server.log', () => {
  it('receives warnings and errors', async () => {
    const logFile = join(mkdtempSync(join(tmpdir(), 'chess-log-')), 'server.log');
    const server = app(logFile);
    server.log.error(new Error('Something broke'));
    await server.close();
    await vi.waitFor(() => expect(readFileSync(logFile, 'utf8')).toContain('Something broke'));
  });

  it('starts afresh past 1 MB, keeping the previous log', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'chess-log-'));
    const logFile = join(folder, 'server.log');
    writeFileSync(logFile, 'x'.repeat(1_100_000));
    const server = app(logFile);
    await server.close();
    expect(existsSync(`${logFile}.1`)).toBe(true);
    expect(readFileSync(logFile, 'utf8').length).toBeLessThan(1000);
  });
});
