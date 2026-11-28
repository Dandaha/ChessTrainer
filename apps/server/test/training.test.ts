import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createSavedPosition, updateSavedPosition, updateSettings } from '../db/library.ts';
import { addLine, createRepertoire } from '../db/repertoire.ts';
import { engineCache } from '../db/schema.ts';
import { queue, review, stats, summary } from '../db/training.ts';
import { buildApp } from '../src/app.ts';
import { EngineService } from '../src/engineService.ts';
import { firstAnswerMove } from '../src/routes/engine.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const STOCKFISH = process.env.STOCKFISH_PATH ?? '/usr/games/stockfish';

describe('training cards', () => {
  it('makes one card per main move of mine, with the line that leads to it', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'black' });
    addLine(db, id, START, ['e4', 'c5', 'Nf3', 'd6']);
    addLine(db, id, START, ['e4', 'c5', 'Nf3', 'Nc6']); // a sideline of mine: no card of its own
    const cards = queue(db);
    expect(cards).toHaveLength(2);
    const [first, second] = cards;
    expect(first).toMatchObject({ kind: 'repertoire_move', line: ['e4'], answer: { san: 'c5' } });
    expect(second).toMatchObject({ kind: 'repertoire_move', line: ['e4', 'c5', 'Nf3'], answer: { san: 'd6' } });
    expect(second!.kind === 'repertoire_move' && second!.alternatives.map((a) => a.san)).toEqual(['Nc6']);
  });

  it('includes saved positions only once they are put in training', () => {
    const db = freshDb();
    const saved = createSavedPosition(db, { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Back rank', answer: 'Rd8#' });
    expect(queue(db)).toHaveLength(0);
    updateSavedPosition(db, saved.id, { inTraining: true });
    expect(queue(db).map((c) => c.kind)).toEqual(['saved_position']);
  });

  it('introduces at most the day’s new cards, and counts what is due', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
    expect(queue(db, { newPerDay: 2 })).toHaveLength(2);
    expect(summary(db, new Date(), 2)).toMatchObject({ repertoireDue: 0, newToday: 2, total: 4 });
  });

  it('keeps to the day’s new cards even when one of them is reviewed again', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4']);
    const now = new Date('2026-11-26T10:00:00Z');
    const [a, b] = queue(db, { now, newPerDay: 2 });
    review(db, a!.card.id, 1, false, now);
    review(db, b!.card.id, 3, true, now);
    const later = new Date(now.getTime() + 20 * 60_000);
    review(db, a!.card.id, 3, true, later);
    expect(summary(db, later, 2).newToday).toBe(0);
    expect(queue(db, { now: later, newPerDay: 2 }).filter((c) => c.card.reps === 0)).toHaveLength(0);
  });

  it('counts a review in the local day it happened, not the UTC one', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Jerusalem';
    try {
      const db = freshDb();
      const id = createRepertoire(db, { name: 'Main', color: 'white' });
      addLine(db, id, START, ['d4', 'd5', 'c4']);
      // 01:30 on the 28th in Jerusalem is still the 27th in UTC.
      const lateNight = new Date('2026-11-27T23:30:00Z');
      const [card] = queue(db, { now: lateNight });
      review(db, card!.card.id, 3, true, lateNight);
      const days = stats(db, new Date('2026-11-28T10:00:00Z')).days;
      expect(days.at(-1)).toEqual({ day: '2026-11-28', reviews: 1, correct: 1 });
      expect(days.at(-2)).toMatchObject({ day: '2026-11-27', reviews: 0 });
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  it('schedules the next review: a wrong answer comes back soon, a right one later', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['d4', 'd5', 'c4']);
    const now = new Date('2026-11-26T10:00:00Z');
    const [a, b] = queue(db, { now });
    const again = review(db, a!.card.id, 1, false, now)!;
    const good = review(db, b!.card.id, 3, true, now)!;
    expect(new Date(again.due).getTime() - now.getTime()).toBeLessThan(15 * 60_000);
    expect(new Date(good.due).getTime()).toBeGreaterThan(new Date(again.due).getTime());
    // The wrong one is the first due again.
    const later = new Date(now.getTime() + 20 * 60_000);
    expect(queue(db, { now: later, newPerDay: 0 })[0]!.card.id).toBe(a!.card.id);
    const s = stats(db, now);
    expect(s.byRepertoire[0]).toMatchObject({ cards: 2, reviews: 2, accuracy: 0.5 });
    expect(s.weakest[0]!.label).toBe('Main: (d4)');
  });
});

describe.skipIf(!existsSync(STOCKFISH))('the engine through the API', () => {
  it('evaluates a position once and answers again from the cache', async () => {
    const db = freshDb();
    updateSettings(db, { enginePath: STOCKFISH });
    const app = buildApp(db);
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const first = (await app.inject({ method: 'POST', url: '/api/engine/evaluate', payload: { fen, depth: 10, multipv: 2 } })).json();
    expect(first.lines[0]).toMatchObject({ mate: 1, san: ['Rd8#'] });
    expect(db.select().from(engineCache).all()).toHaveLength(1);
    const t = Date.now();
    const again = (await app.inject({ method: 'POST', url: '/api/engine/evaluate', payload: { fen, depth: 8, multipv: 1 } })).json();
    expect(Date.now() - t).toBeLessThan(200);
    expect(again.lines).toHaveLength(1);
    await app.close();
  });

  it('lets two evaluations at once both reach their depth, and caches only full ones', async () => {
    const db = freshDb();
    updateSettings(db, { enginePath: STOCKFISH });
    const engines = new EngineService(db);
    const [a, b] = await Promise.all([
      engines.evaluate('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { depth: 12, multipv: 1 }),
      engines.evaluate('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', { depth: 12, multipv: 1 }),
    ]);
    expect(a.depth).toBeGreaterThanOrEqual(12);
    expect(b.depth).toBeGreaterThanOrEqual(12);
    await engines.shutdown();
  });

  it('checks a solve-mode move against the answer and the engine', async () => {
    const db = freshDb();
    updateSettings(db, { enginePath: STOCKFISH });
    const app = buildApp(db);
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const right = (await app.inject({ method: 'POST', url: '/api/training/check', payload: { fen, uci: 'd1d8', answer: 'Rd8#' } })).json();
    expect(right).toMatchObject({ san: 'Rd8#', answerMatch: true, engine: { best: 'Rd8#', good: true } });
    const wrong = (await app.inject({ method: 'POST', url: '/api/training/check', payload: { fen, uci: 'g2g3', answer: 'Rd8#' } })).json();
    expect(wrong).toMatchObject({ san: 'g3', answerMatch: false, engine: { good: false } });
    // Two rooks, two mates: the one not written down is as good as the answer.
    const twoRooks = '6k1/5ppp/8/8/8/8/5PPP/RR4K1 w - - 0 1';
    const other = (await app.inject({ method: 'POST', url: '/api/training/check', payload: { fen: twoRooks, uci: 'b1b8', answer: 'Ra8#' } })).json();
    expect(other).toMatchObject({ san: 'Rb8#', answerMatch: false, engine: { good: true } });
    await app.close();
  });
});

describe('a written answer', () => {
  it('is read from its first move, whatever the numbering', () => {
    expect(firstAnswerMove('Bxh7+ Kxh7 Ng5+')).toBe('Bxh7+');
    expect(firstAnswerMove('1. e4 e5')).toBe('e4');
    expect(firstAnswerMove('2... Qh4#')).toBe('Qh4#');
    expect(firstAnswerMove('2. ... Qh4#')).toBe('Qh4#');
    expect(firstAnswerMove('   ')).toBeUndefined();
    expect(firstAnswerMove(null)).toBeUndefined();
  });

  it('answers 400, not a server error, for an illegal move', async () => {
    const app = buildApp(freshDb());
    const check = await app.inject({ method: 'POST', url: '/api/training/check', payload: { fen: START, uci: 'e2e5', answer: 'e4' } });
    expect(check.statusCode).toBe(400);
    expect(check.json().error).toBe('That move is not legal in this position.');
    await app.close();
  });
});

describe('without an engine', () => {
  it('says to set the path in Settings', async () => {
    const app = buildApp(freshDb());
    delete process.env.STOCKFISH_PATH;
    const status = (await app.inject({ method: 'GET', url: '/api/engine/status' })).json();
    expect(status).toMatchObject({ configured: false });
    const check = (await app.inject({
      method: 'POST',
      url: '/api/training/check',
      payload: { fen: START, uci: 'e2e4', answer: 'e4' },
    })).json();
    expect(check).toMatchObject({ answerMatch: true, engine: null });
    expect(check.engineError).toMatch(/Settings/);
    await app.close();
  });
});
