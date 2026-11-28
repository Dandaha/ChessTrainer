import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../engine.ts';
import { type ToolContext, runTool, toolDefinitions } from '../tools.ts';

const PATH = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

describe('tool definitions', () => {
  it('describes every tool with a JSON schema', () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([
      'evaluate',
      'compare_moves',
      'play_line',
      'position_facts',
      'find_threats',
      'search_concepts',
      'get_repertoire',
      'search_games',
      'opening_stats',
    ]);
    const compare = defs.find((d) => d.name === 'compare_moves')!;
    expect(compare.input_schema).toMatchObject({ type: 'object', required: ['fen', 'moves'] });
  });

  it('rejects bad input with a message the model can read', async () => {
    const ctx: ToolContext = { analyse: async () => ({ fen: '', engine: '', depth: 0, lines: [] }) };
    expect(await runTool('evaluate', { fen: 'not a fen' }, ctx)).toEqual({ error: 'Invalid input: fen: Not a valid FEN.' });
    expect(await runTool('nope', {}, ctx)).toEqual({ error: 'There is no tool called nope.' });
    expect(await runTool('search_concepts', { query: 'minority attack' }, ctx)).toEqual({ error: 'The chess database is not available here.' });
  });

  it('answers position_facts without an engine', async () => {
    const ctx: ToolContext = { analyse: async () => { throw new Error('no engine'); } };
    const facts = (await runTool('position_facts', { fen: BACK_RANK }, ctx)) as { checksAvailable: string[] };
    expect(facts.checksAvailable).toEqual(['Rd8#']);
  });

  it('compare_moves scores the best move the way it scores the others', async () => {
    // A root search at depth 18 says +0.50; one at depth 17 after the move says +0.20. Set against
    // each other, the best move would be "0.3 worse than best".
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const line = (cp: number, san: string[]) => ({ multipv: 1, depth: 17, cp, pv: [], san });
    const ctx: ToolContext = {
      analyse: async (f) => {
        if (f === START) return { fen: f, engine: 'fake', depth: 18, lines: [line(50, ['e4', 'e5'])] };
        const pawnOnD4 = f.startsWith('rnbqkbnr/pppppppp/8/8/3P4');
        return { fen: f, engine: 'fake', depth: 17, lines: [line(pawnOnD4 ? 10 : 20, ['e5'])] };
      },
    };
    const r = (await runTool('compare_moves', { fen: START, moves: ['e4', 'd4'] }, ctx)) as { candidates: Record<string, unknown>[] };
    expect(r.candidates[0]).toMatchObject({ move: 'e4', isBest: true, lossVsBestInPawns: 0 });
    expect(r.candidates[1]).toMatchObject({ move: 'd4', isBest: false, lossVsBestInPawns: 0.1 });
  });

  it('passes database questions to the data source', async () => {
    const ctx: ToolContext = {
      analyse: async () => ({ fen: '', engine: '', depth: 0, lines: [] }),
      data: { searchConcepts: (q) => [{ title: `found ${q}` }], repertoireAt: () => [], gamesAt: () => ({ total: 0 }) },
    };
    expect(await runTool('search_concepts', { query: 'lucena' }, ctx)).toEqual([{ title: 'found lucena' }]);
  });
});

describe.skipIf(!existsSync(PATH))('tools with Stockfish', () => {
  let engine: Engine;
  let ctx: ToolContext;
  beforeAll(async () => {
    engine = await Engine.start({ path: PATH, threads: 1, hashMb: 16 });
    ctx = { analyse: (fen, o) => engine.analyse(fen, { depth: Math.min(o.depth ?? 12, 12), multipv: o.multipv }) };
  });
  afterAll(async () => engine?.quit());

  it('evaluate finds the mate', async () => {
    const r = (await runTool('evaluate', { fen: BACK_RANK, multipv: 2 }, ctx)) as { lines: { score: string; moves: string }[] };
    expect(r.lines[0]).toMatchObject({ score: '#1', moves: 'Rd8#' });
  });

  it('compare_moves shows the loss and the refutation of a worse move', async () => {
    const r = (await runTool('compare_moves', { fen: BACK_RANK, moves: ['Rd8#', 'g3', 'Qh5'] }, ctx)) as {
      best: { move: string };
      candidates: Record<string, unknown>[];
    };
    expect(r.best.move).toBe('Rd8#');
    expect(r.candidates[0]).toMatchObject({ move: 'Rd8#', isBest: true });
    expect(r.candidates[1]).toMatchObject({ move: 'g3', lossVsBestInPawns: 'loses a forced mate or allows one' });
    expect(r.candidates[2]).toMatchObject({ move: 'Qh5', error: 'Not a legal move in this position.' });
  });

  it('play_line reports the end position and stops at an illegal move', async () => {
    const r = (await runTool('play_line', { fen: BACK_RANK, moves: ['Rd8#', 'Kh8'] }, ctx)) as Record<string, unknown>;
    expect(r).toMatchObject({ played: ['Rd8#'], stoppedAt: 'Kh8', checks: ['Rd8#'] });
    expect(r.evalAtEnd).toMatchObject({ note: expect.stringContaining('checkmate') });
  });

  it('find_threats shows what the opponent threatens', async () => {
    // White to move; Black threatens ...Rd1#.
    const fen = '3r2k1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1';
    const r = (await runTool('find_threats', { fen }, ctx)) as { threatsFor: string; threats: { move: string; scoreIfAllowed: string }[] };
    expect(r.threatsFor).toBe('black');
    expect(r.threats[0]).toMatchObject({ move: 'Rd1#', scoreIfAllowed: '-#1' });
  });
});
