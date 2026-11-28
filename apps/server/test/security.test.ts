import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { buildApp, isLocalHost } from '../src/app.ts';

/** The API answers the app's own pages only: not other sites, not DNS rebinding. */

function app() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return buildApp(db);
}

describe('the local API', () => {
  it('answers requests addressed to this machine by a local name', async () => {
    const server = app();
    for (const host of ['127.0.0.1:47123', 'localhost:5173', 'localhost', '[::1]:47123']) {
      expect((await server.inject({ method: 'GET', url: '/api/health', headers: { host } })).statusCode).toBe(200);
    }
    const write = await server.inject({ method: 'PUT', url: '/api/settings', headers: { host: '127.0.0.1:47123', origin: 'http://127.0.0.1:47123' }, payload: { rating: 1500 } });
    expect(write.statusCode).toBe(200);
  });

  it('refuses a rebound host name and pages from other sites', async () => {
    const server = app();
    const rebound = await server.inject({ method: 'PUT', url: '/api/settings', headers: { host: 'attacker.example:47123' }, payload: { enginePath: '/tmp/evil' } });
    expect(rebound.statusCode).toBe(403);
    for (const origin of ['https://attacker.example', 'null', 'http://127.0.0.1.attacker.example']) {
      const crossSite = await server.inject({ method: 'GET', url: '/api/settings', headers: { host: '127.0.0.1:47123', origin } });
      expect(crossSite.statusCode).toBe(403);
    }
    expect((await server.inject({ method: 'GET', url: '/api/settings' })).json().enginePath).toBeUndefined();
    expect(isLocalHost('127.0.0.1.nip.io')).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
  });

  it('refuses plain-text bodies, which a cross-site form could send', async () => {
    const response = await app().inject({ method: 'POST', url: '/api/games', headers: { 'content-type': 'text/plain' }, payload: '{"pgn":"1. e4 *"}' });
    expect(response.statusCode).toBe(415);
  });

  it('tries an engine path without saving it', async () => {
    const server = app();
    const tried = await server.inject({ method: 'POST', url: '/api/engine/test', payload: { path: '/no/such/engine' } });
    expect(tried.statusCode).toBe(400);
    expect(tried.json().error).toBe('There is no file at /no/such/engine.');
    expect((await server.inject({ method: 'GET', url: '/api/settings' })).json().enginePath).toBeUndefined();
  });
});
