import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { addLine, createRepertoire, deleteMove, getEdges, listRepertoires, repertoiresAt, updateMove } from '../db/repertoire.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_D4_NF6_C4 = 'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 2';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LICHESS_TOKEN;
});

describe('repertoires in the database', () => {
  it('adds a line as moves between positions, marking mine and the main line', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    expect(addLine(db, id, START, ['d4', 'Nf6', 'c4'])).toEqual({ added: 3, existing: 0 });
    expect(addLine(db, id, START, ['d4', 'd5', 'c4'])).toEqual({ added: 2, existing: 1 });
    const edges = getEdges(db, id);
    expect(edges.map((e) => [e.san, e.isMyMove, e.isMain])).toEqual([
      ['d4', true, true],
      ['Nf6', false, true],
      ['c4', true, true],
      ['d5', false, false],
      ['c4', true, true],
    ]);
    expect(listRepertoires(db)[0]).toMatchObject({ name: 'Main', moves: 5 });
  });

  it('keeps one main line per position', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['d4']);
    addLine(db, id, START, ['c4']);
    const c4 = getEdges(db, id).find((e) => e.san === 'c4')!;
    updateMove(db, c4.id, { isMain: true, priority: 'nice', comment: 'English' });
    const edges = getEdges(db, id);
    expect(edges.map((e) => [e.san, e.isMain])).toEqual([
      ['d4', false],
      ['c4', true],
    ]);
    expect(edges[1]).toMatchObject({ priority: 'nice', comment: 'English' });
  });

  it('deletes a move with the moves only reachable through it', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['d4', 'Nf6', 'c4', 'e6']);
    addLine(db, id, START, ['c4']);
    const nf6 = getEdges(db, id).find((e) => e.san === 'Nf6')!;
    expect(deleteMove(db, nf6.id)).toBe(3);
    expect(getEdges(db, id).map((e) => e.san)).toEqual(['d4', 'c4']);
  });

  it('answers what each repertoire has at a position, including a transposition', () => {
    const db = freshDb();
    const white = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, white, START, ['d4', 'Nf6', 'c4', 'e6', 'Nc3']);
    // Reached by 1.c4 Nf6 2.d4: same position, other order.
    const here = repertoiresAt(db, AFTER_D4_NF6_C4);
    expect(here).toHaveLength(1);
    expect(here[0]!.reached).toBe(true);
    expect(here[0]!.moves.map((m) => m.san)).toEqual(['e6']);
  });
});

describe('the repertoire API', () => {
  it('imports PGN with variations, exports it, and checks a game against it', async () => {
    const app = buildApp(freshDb());
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Black', color: 'black' } })).json();
    const imported = await app.inject({
      method: 'POST',
      url: `/api/repertoires/${id}/import`,
      payload: { pgn: '1. e4 c5 2. Nf3 d6 (2... Nc6) 3. d4 cxd4 *\n\n1. d4 Nf6 2. c4 g6 *' },
    });
    expect(imported.json()).toMatchObject({ added: 11, games: 2, errors: [] });

    const exported = (await app.inject({ method: 'GET', url: `/api/repertoires/${id}/export` })).json().pgn as string;
    expect(exported).toContain('1. e4 (1. d4 Nf6 2. c4 g6) 1... c5 2. Nf3 d6 (2... Nc6) 3. d4 cxd4 *');

    const check = await app.inject({
      method: 'POST',
      url: '/api/repertoires/check',
      payload: { pgn: '1. e4 c5 2. Nf3 e6 3. d4 *', color: 'black' },
    });
    expect(check.json()[0].message).toBe('You left your preparation on move 2 with ...e6; your line is ...d6 or ...Nc6.');
    await app.close();
  });

  it('explains that the gap finder needs a Lichess token', async () => {
    const app = buildApp(freshDb());
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'W', color: 'white' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4'] } });
    const response = await app.inject({ method: 'GET', url: `/api/repertoires/${id}/gaps` });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/LICHESS_TOKEN/);
    await app.close();
  });

  it('lists common replies the repertoire does not answer', async () => {
    process.env.LICHESS_TOKEN = 'test-token';
    vi.stubGlobal('fetch', async (url: string) => {
      expect(String(url)).toContain('explorer.lichess.ovh');
      return new Response(
        JSON.stringify({
          white: 500,
          draws: 100,
          black: 400,
          moves: [
            { uci: 'e7e5', san: 'e5', white: 200, draws: 50, black: 150 },
            { uci: 'c7c5', san: 'c5', white: 150, draws: 30, black: 120 },
            { uci: 'a7a6', san: 'a6', white: 5, draws: 0, black: 5 },
          ],
        }),
      );
    });
    const app = buildApp(freshDb());
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'W', color: 'white' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4', 'e5', 'Nf3'] } });
    const response = await app.inject({ method: 'GET', url: `/api/repertoires/${id}/gaps?maxPositions=1` });
    // After 1.e4, e5 is covered; c5 (30%) is a gap; a6 (1%) is too rare to list.
    expect(response.json().gaps.map((g: { move: { san: string }; share: number }) => [g.move.san, g.share])).toEqual([['c5', 0.3]]);
    await app.close();
  });
});
