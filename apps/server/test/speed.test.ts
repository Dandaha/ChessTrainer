import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { importGames, listGames, timeControls } from '../db/games.ts';
import { formatTimeControl, speedOf } from '@chess/chess-core';

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

describe('the speed of a game', () => {
  it('follows Lichess: base time plus 40 increments', () => {
    expect(speedOf('15+0')).toBe('ultrabullet');
    expect(speedOf('60+0')).toBe('bullet');
    expect(speedOf('120+1')).toBe('bullet');
    expect(speedOf('180+2')).toBe('blitz');
    expect(speedOf('300')).toBe('blitz');
    expect(speedOf('600+0')).toBe('rapid');
    expect(speedOf('900+10')).toBe('rapid');
    expect(speedOf('1800+0')).toBe('classical');
  });

  it('knows correspondence, and says nothing when it cannot tell', () => {
    expect(speedOf('1/86400')).toBe('correspondence');
    expect(speedOf('-', 'Rated Correspondence game')).toBe('correspondence');
    expect(speedOf('-', 'Club championship')).toBeNull();
    expect(speedOf(null)).toBeNull();
    expect(speedOf('40/7200:3600')).toBeNull();
  });

  it('writes a time control as people say it', () => {
    expect(formatTimeControl('180+2')).toBe('3+2');
    expect(formatTimeControl('600')).toBe('10+0');
    expect(formatTimeControl('30+0')).toBe('½+0');
    expect(formatTimeControl('-')).toBeNull();
    expect(formatTimeControl('1/86400')).toBe('1 day/move');
    expect(formatTimeControl('1/259200')).toBe('3 days/move');
    expect(formatTimeControl('40/7200:3600')).toBe('40/7200:3600');
  });
});

const game = (white: string, tc: string) => `[White "${white}"]\n[Black "X"]\n[TimeControl "${tc}"]\n\n1. e4 *\n`;

describe('filtering by time control', () => {
  it('filters by speed and by the exact time control, and lists the controls played', () => {
    const { db } = openDatabase(':memory:');
    runMigrations(db);
    importGames(db, [game('A', '180+2'), game('B', '180+2'), game('C', '60+0'), game('D', '900+10')].join('\n'), { source: 'file' });
    expect(listGames(db, { speed: 'blitz' }).games.map((g) => g.white).sort()).toEqual(['A', 'B']);
    expect(listGames(db, { timeControl: '60+0' }).games.map((g) => g.white)).toEqual(['C']);
    expect(listGames(db, { speed: 'rapid' }).games[0]).toMatchObject({ white: 'D', timeControl: '900+10', speed: 'rapid' });
    expect(timeControls(db)[0]).toEqual({ timeControl: '180+2', speed: 'blitz', games: 2 });
  });

  it('fills in games already in the library when the database is updated', () => {
    const folder = mkdtempSync(join(tmpdir(), 'chess-speed-'));
    const before = join(folder, 'migrations');
    cpSync(MIGRATIONS, before, { recursive: true });
    const journalFile = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalFile, 'utf8')) as { entries: { tag: string }[] };
    const at = journal.entries.findIndex((e) => e.tag.startsWith('0009_'));
    for (const e of journal.entries.slice(at)) rmSync(join(before, `${e.tag}.sql`));
    writeFileSync(journalFile, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
    const { db, close } = openDatabase(join(folder, 'chess.db'));
    migrate(db, { migrationsFolder: before });
    const insert = db.$client.prepare("insert into games (id, pgn, event, source, created_at, updated_at) values (?, ?, ?, 'file', '2026-01-01', '2026-01-01')");
    insert.run(randomUUID(), game('Old', '300+3'), 'Rated Blitz game');
    insert.run(randomUUID(), game('Daily', '1/259200'), 'Let us play');
    insert.run(randomUUID(), '[White "None"]\n\n1. d4 *', null);
    runMigrations(db);
    expect(db.$client.prepare('select time_control, speed from games order by time_control').all()).toEqual([
      { time_control: null, speed: null },
      { time_control: '1/259200', speed: 'correspondence' },
      { time_control: '300+3', speed: 'blitz' },
    ]);
    close();
  });
});
