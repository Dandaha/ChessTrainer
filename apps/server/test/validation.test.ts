import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { buildApp } from '../src/app.ts';

/** Bodies are read through schemas: unknown fields never reach the database, bad ones get a 400. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function app() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return buildApp(db);
}

describe('request bodies', () => {
  it('answers 400 with the field at fault, and writes nothing', async () => {
    const server = app();
    const saved = (await server.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: START, title: 'Start' } })).json();
    const bad = await server.inject({ method: 'PUT', url: `/api/saved-positions/${saved.id}`, payload: { title: 'Changed', sideToSolve: 'purple' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toMatch(/^sideToSolve: /);
    expect((await server.inject({ method: 'GET', url: `/api/saved-positions/${saved.id}` })).json().title).toBe('Start');
  });

  it('drops fields a route does not take, such as a new FEN for a saved position', async () => {
    const server = app();
    const saved = (await server.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: START, title: 'Start' } })).json();
    const other = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';
    const updated = (await server.inject({ method: 'PUT', url: `/api/saved-positions/${saved.id}`, payload: { title: 'Renamed', fen: other, createdAt: '2000-01-01' } })).json();
    expect(updated).toMatchObject({ title: 'Renamed', fen: START, createdAt: saved.createdAt });
    await server.inject({ method: 'PUT', url: '/api/settings', payload: { rating: 1500, favouriteColour: 'green' } });
    expect((await server.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual({ rating: 1500 });
  });

  it('keeps a concept from losing its title', async () => {
    const server = app();
    expect((await server.inject({ method: 'POST', url: '/api/concepts', payload: { title: '   ' } })).statusCode).toBe(400);
    const concept = (await server.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Minority attack' } })).json();
    const blank = await server.inject({ method: 'PUT', url: `/api/concepts/${concept.id}`, payload: { title: ' ' } });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe('title: A concept needs a title.');
    expect((await server.inject({ method: 'GET', url: `/api/concepts/${concept.id}` })).json().title).toBe('Minority attack');
  });

  it('answers 400, not a server error, for a missing or malformed body', async () => {
    const server = app();
    expect((await server.inject({ method: 'POST', url: '/api/games' })).statusCode).toBe(400);
    expect((await server.inject({ method: 'POST', url: '/api/games/delete', payload: { ids: 'all' } })).statusCode).toBe(400);
    expect((await server.inject({ method: 'PUT', url: '/api/settings', payload: { rating: 99999 } })).statusCode).toBe(400);
    const bad = await server.inject({ method: 'POST', url: '/api/training/check', payload: { fen: START, uci: 'e4' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('uci: A move is written like e2e4.');
  });
});
