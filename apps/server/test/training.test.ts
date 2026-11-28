import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createSavedPosition, updateSavedPosition, updateSettings } from '../db/library.ts';
import { addLine, createRepertoire, getEdges, reachesByMyMove, updateMove } from '../db/repertoire.ts';
import { engineCache, trainingCards } from '../db/schema.ts';
import { eq } from 'drizzle-orm';
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

  it('counts as due today exactly what a session then shows, and gives positions a share of the new slots', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
    createSavedPosition(db, { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Back rank', inTraining: true });
    const morning = new Date(2026, 10, 26, 9, 0);
    // New cards: repertoire moves and the position take turns.
    const fresh = queue(db, { now: morning, newPerDay: 3 });
    expect(fresh.map((c) => c.kind)).toEqual(['repertoire_move', 'saved_position', 'repertoire_move']);
    // A card in review due this evening is up today, in the summary and in the queue alike.
    const card = fresh[0]!.card;
    db.$client.prepare('update training_cards set state = 2, due = ? where id = ?').run(new Date(2026, 10, 26, 20, 0).toISOString(), card.id);
    expect(summary(db, morning, 0).repertoireDue).toBe(1);
    expect(queue(db, { now: morning, newPerDay: 0 }).map((c) => c.card.id)).toEqual([card.id]);
  });

  it('knows a position the repertoire reaches through my own moves', () => {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'QGD', color: 'white' });
    addLine(db, id, START, ['d4', 'd5', 'c4', 'e6', 'Nf3', 'Nf6', 'Nc3']);
    // 1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Nf3 reaches the same position as the line's 3.Nf3 Nf6 4.Nc3.
    const transposed = 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 3 4';
    expect(reachesByMyMove(db, id, transposed)).toBe(true);
    expect(reachesByMyMove(db, id, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1')).toBe(false);
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
    expect(s.weakest[0]!.label).toBe('(1.d4) · Main');
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

  it('streams to the depth asked, answers from the cache when it already went that deep, and keeps a weakened engine out of it', async () => {
    const db = freshDb();
    updateSettings(db, { enginePath: STOCKFISH });
    const engines = new EngineService(db);
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const run = (settings: { depth?: number; elo?: number }) =>
      new Promise<{ depth: number; updates: number }>((resolve) => {
        let updates = 0;
        void engines.stream(fen, 1, () => (updates += 1), (a) => resolve({ depth: a.depth, updates }), undefined, settings);
      });
    const first = await run({ depth: 10 });
    expect(first.depth).toBeGreaterThanOrEqual(10);
    expect(first.depth).toBeLessThan(14);
    // Cached at depth 10: a search to 8 is answered at once, without updates.
    expect(await run({ depth: 8 })).toEqual({ depth: first.depth, updates: 0 });
    // A weakened engine searches for itself and is not stored.
    const weak = await run({ depth: 6, elo: 1500 });
    expect(weak.updates).toBeGreaterThan(0);
    expect(await run({ depth: 8 })).toEqual({ depth: first.depth, updates: 0 });
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

describe('nice to know', () => {
  function withNiceLine() {
    const db = freshDb();
    const id = createRepertoire(db, { name: 'Main', color: 'white' });
    addLine(db, id, START, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O']);
    addLine(db, id, START, ['e4', 'b6', 'd4']); // a rare reply, marked nice to know below
    const b6 = getEdges(db, id).find((e) => e.san === 'b6')!;
    updateMove(db, b6.id, { priority: 'nice' });
    return { db, id };
  }

  it('introduces the must-know moves first, however deep, and marks the others', () => {
    const { db } = withNiceLine();
    const cards = queue(db, { newPerDay: 20 });
    const answers = cards.map((c) => (c.kind === 'repertoire_move' ? `${c.answer.san}${c.nice ? '*' : ''}` : ''));
    expect(answers).toEqual(['e4', 'Nf3', 'Bb5', 'Ba4', 'O-O', 'd4*']);
  });

  it('schedules a nice-to-know card further out than a must-know one', () => {
    const { db } = withNiceLine();
    const cards = queue(db, { newPerDay: 20 });
    const must = cards.find((c) => c.kind === 'repertoire_move' && c.answer.san === 'Ba4')!;
    const nice = cards.find((c) => c.kind === 'repertoire_move' && c.answer.san === 'd4')!;
    // Both learned ten days ago with the same memory, and due today.
    const now = new Date('2026-06-15T12:00:00Z');
    for (const c of [must, nice]) {
      db.update(trainingCards)
        .set({ state: 2, stability: 10, difficulty: 5, reps: 3, lapses: 0, lastReview: '2026-06-05T12:00:00.000Z', due: '2026-06-15T00:00:00.000Z', scheduledDays: 10 })
        .where(eq(trainingCards.id, c.card.id))
        .run();
    }
    const dueMust = new Date(review(db, must.card.id, 3, true, now)!.due).getTime();
    const dueNice = new Date(review(db, nice.card.id, 3, true, now)!.due).getTime();
    expect(dueNice).toBeGreaterThan(dueMust * 1 + 3 * 86_400_000);
  });
});

describe('the day\'s counts for one repertoire', () => {
  it('count only that repertoire, as its session shows', () => {
    const db = freshDb();
    const white = createRepertoire(db, { name: 'White', color: 'white' });
    const black = createRepertoire(db, { name: 'Black', color: 'black' });
    addLine(db, white, START, ['e4', 'e5', 'Nf3']);
    addLine(db, black, START, ['e4', 'c5', 'Nf3', 'd6']);
    createSavedPosition(db, { fen: START, title: 'Start', inTraining: true });
    expect(summary(db).total).toBe(5);
    expect(summary(db, new Date(), 20, black)).toMatchObject({ total: 2, newToday: 2, positionsDue: 0 });
    expect(queue(db, { repertoireId: black }).length).toBe(2);
  });
});
