import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Engine, engineEnvironment } from '../engine.ts';
import { formatScore, scoreValue, uciToSan } from '../score.ts';

// The tests need a Stockfish binary: STOCKFISH_PATH, or the Linux package's path.
const PATH = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';
const available = existsSync(PATH);

describe('scores and lines', () => {
  it('formats scores for people', () => {
    expect(formatScore({ cp: 35 })).toBe('+0.35');
    expect(formatScore({ cp: -120 })).toBe('-1.20');
    expect(formatScore({ mate: 3 })).toBe('#3');
    expect(formatScore({ mate: -2 })).toBe('-#2');
    expect(scoreValue({ mate: 1 })).toBeGreaterThan(scoreValue({ cp: 900 }));
  });

  it('turns a UCI line into SAN', () => {
    expect(uciToSan('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3', 'x9x9'])).toEqual(['e4', 'e5', 'Nf3']);
  });
});

describe('the engine process', () => {
  it('gets no secrets in its environment', () => {
    const env = engineEnvironment({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows', ANTHROPIC_API_KEY: 'sk-ant-x', LICHESS_TOKEN: 'lip_x', MY_SECRET: 's' });
    expect(env).toEqual({ PATH: '/usr/bin', SystemRoot: 'C:\\Windows' });
  });
});

describe.skipIf(!available)('Stockfish', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await Engine.start({ path: PATH, threads: 1, hashMb: 16 });
  });
  afterAll(async () => {
    await engine?.quit();
  });

  it('finds a mate in one and reports it from White’s point of view', async () => {
    const result = await engine.analyse('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { depth: 8, multipv: 2 });
    expect(result.engine).toMatch(/Stockfish/);
    expect(result.lines[0]).toMatchObject({ mate: 1, san: ['Rd8#'] });
    expect(result.lines).toHaveLength(2);
  });

  it('reports positions with fewer legal moves than lines asked for', async () => {
    // Two legal moves for Black; three lines asked.
    const fen = '4kb1r/rp2pp1p/p5pn/2pp4/Q3PN1P/P1Pn1P2/RP1P2P1/1NB2K1R b k - 0 14';
    const updates: number[] = [];
    const result = await engine.analyse(fen, { depth: 8, multipv: 3, onUpdate: (a) => updates.push(a.depth) });
    expect(result.lines).toHaveLength(2);
    expect(result.depth).toBeGreaterThanOrEqual(8);
    expect(updates.length).toBeGreaterThan(1);
  });

  it('searches the position reached by the moves it is given', async () => {
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2';
    const result = await engine.analyse(fen, { depth: 6, multipv: 1, history: { startFen: start, moves: ['e2e4', 'e7e5'] } });
    // The line is read from the position after 1.e4 e5: legal there, so it has SAN.
    expect(result.lines[0]?.san.length).toBeGreaterThan(0);
  });

  it('says at once when the program ends instead of answering', async () => {
    const started = Date.now();
    await expect(Engine.start({ path: '/bin/false' })).rejects.toThrow(/stopped .* before answering as a UCI engine/);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('refuses a position no game can reach instead of choking on it mid-search', async () => {
    await expect(engine.analyse('4k3/8/8/8/8/8/3q4/4K3 b - - 0 1', { depth: 4 })).rejects.toThrow('not a legal chess position');
  });

  it('gives a negative score when Black is winning with Black to move', async () => {
    const result = await engine.analyse('4k3/8/8/8/8/8/3q4/K7 b - - 0 1', { depth: 10, multipv: 1 });
    const best = result.lines[0]!;
    expect(best.mate !== undefined ? best.mate < 0 : best.cp! < -500).toBe(true);
  });

  it('streams updates and stops when asked', async () => {
    const depths: number[] = [];
    const running = engine.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', {
      multipv: 3,
      onUpdate: (a) => depths.push(a.depth),
    });
    await new Promise((r) => setTimeout(r, 300));
    engine.stop();
    const result = await running;
    expect(depths.length).toBeGreaterThan(0);
    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]!.san.length).toBeGreaterThan(0);
  });

  it('a new search replaces the running one', async () => {
    const first = engine.analyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', { multipv: 1 });
    const second = engine.analyse('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { depth: 6, multipv: 1 });
    await first;
    expect((await second).lines[0]!.san[0]).toBe('Rd8#');
  });
});

describe('a missing engine', () => {
  it('explains what is wrong', async () => {
    await expect(Engine.start({ path: '/no/such/stockfish' })).rejects.toThrow(/Could not start Stockfish/);
  });
});
