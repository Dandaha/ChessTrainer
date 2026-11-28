import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { buildApp } from '../src/app.ts';

/** The Lichess token is checked with Lichess, kept in .env only, and never sent back. */

// Built at run time: a literal shaped like a Lichess token would trip GitHub's secret scanning.
const TOKEN = ['lip', 'x'.repeat(20)].join('_');

describe('the Lichess token', () => {
  let envFile: string;
  beforeEach(() => {
    envFile = join(mkdtempSync(join(tmpdir(), 'lichess-')), '.env');
    process.env.CHESS_ENV_FILE = envFile;
    delete process.env.LICHESS_TOKEN;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CHESS_ENV_FILE;
    delete process.env.LICHESS_TOKEN;
  });

  function app() {
    const { db } = openDatabase(':memory:');
    runMigrations(db);
    return buildApp(db);
  }

  it('is kept once Lichess accepts it, and never sent back', async () => {
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const auth = new Headers(init.headers).get('Authorization');
      return new Response(JSON.stringify({ username: 'dave' }), { status: auth === `Bearer ${TOKEN}` ? 200 : 401 });
    });
    const server = app();
    const saved = await server.inject({ method: 'PUT', url: '/api/lichess/token', payload: { token: TOKEN } });
    expect(saved.json()).toEqual({ connected: true, username: 'dave' });
    expect(saved.body).not.toContain(TOKEN);
    expect(readFileSync(envFile, 'utf8')).toBe(`LICHESS_TOKEN=${TOKEN}\n`);
    expect((await server.inject({ method: 'GET', url: '/api/lichess/token' })).json()).toEqual({ connected: true });
    await server.inject({ method: 'DELETE', url: '/api/lichess/token' });
    expect((await server.inject({ method: 'GET', url: '/api/lichess/token' })).json()).toEqual({ connected: false });
  });

  it('is refused when it is malformed or Lichess does not accept it', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 401 }));
    const server = app();
    expect((await server.inject({ method: 'PUT', url: '/api/lichess/token', payload: { token: 'nope' } })).json().error).toMatch(/start with lip_/);
    const refused = await server.inject({ method: 'PUT', url: '/api/lichess/token', payload: { token: TOKEN } });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error).toBe('Lichess did not accept this token.');
    expect(process.env.LICHESS_TOKEN).toBeUndefined();
  });
});
