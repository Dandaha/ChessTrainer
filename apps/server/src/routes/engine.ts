import { createGame, playMove } from '@chess/chess-core';
import { EngineError, scoreValue } from '@chess/chess-tools';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import { queue, review, stats, summary } from '../../db/training.ts';
import type { EngineService } from '../engineService.ts';
import { bodies, parseBody } from '../validate.ts';

/** Phase 4: Stockfish analysis (live and cached) and spaced-repetition training. */
export function engineRoutes(app: FastifyInstance, db: Db, engines: EngineService): void {
  app.get('/api/engine/status', async () => engines.status());
  // Settings tries a path here before saving it, so a wrong one never replaces a working engine.
  app.post('/api/engine/test', async (req, reply) => {
    const path = parseBody(bodies.engineTest, req.body).path.trim();
    if (!path) return reply.code(400).send({ error: 'Give the full path of the engine program.' });
    try {
      return { name: await engines.test(path) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof EngineError ? error.message : `${path} could not be started.` });
    }
  });

  app.post('/api/engine/evaluate', async (req) => {
    const body = parseBody(bodies.evaluate, req.body);
    return engines.evaluate(body.fen, { depth: Math.min(body.depth ?? 18, 30), multipv: Math.min(body.multipv ?? 3, 5) });
  });

  /** Server-sent events with the lines as they deepen. Closing the panel closes the stream and stops the search. */
  app.get('/api/engine/stream', async (req, reply) => {
    const q = req.query as { fen: string; multipv?: string };
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let stop: (() => void) | null = null;
    req.raw.on('close', () => stop?.());
    try {
      stop = await engines.stream(
        q.fen,
        Math.min(Math.max(Number(q.multipv ?? 3), 1), 5),
        (analysis) => send('update', analysis),
        (analysis) => {
          send('done', analysis);
          res.end();
        },
      );
    } catch (error) {
      send('error', { error: error instanceof EngineError ? error.message : 'The engine could not start.' });
      res.end();
    }
  });

  // Training ---------------------------------------------------------------------
  const newPerDay = () => 20;

  app.get('/api/training/summary', async () => summary(db, new Date(), newPerDay()));

  app.get('/api/training/queue', async (req) => {
    const q = req.query as { repertoireId?: string; type?: 'repertoire_move' | 'saved_position' };
    return queue(db, { repertoireId: q.repertoireId, type: q.type, newPerDay: newPerDay() });
  });

  app.post('/api/training/review', async (req, reply) => {
    const body = parseBody(bodies.review, req.body);
    const card = review(db, body.cardId, body.rating, body.correct);
    return card ?? reply.code(404).send({ error: 'No such card.' });
  });

  app.get('/api/training/stats', async () => stats(db));

  /**
   * Checks a move played in solve mode: against the written answer, and
   * against Stockfish when it is set up (a move within half a pawn of the best
   * one counts as good).
   */
  app.post('/api/training/check', async (req, reply) => {
    const body = parseBody(bodies.check, req.body);
    let played: ReturnType<typeof playMove>;
    try {
      played = playMove(createGame(body.fen).root, { from: body.uci.slice(0, 2), to: body.uci.slice(2, 4), promotion: body.uci[4] });
    } catch {
      return reply.code(400).send({ error: 'That move is not legal in this position.' });
    }
    const firstAnswer = firstAnswerMove(body.answer);
    const answerMatch = firstAnswer ? cleanSan(firstAnswer) === cleanSan(played.san) : null;
    let engine: { best: string; bestScore: number; playedScore: number; loss: number; good: boolean } | null = null;
    let engineError: string | null = null;
    try {
      const before = await engines.evaluate(body.fen, { depth: 16, multipv: 3 });
      const best = before.lines[0];
      if (best) {
        const sign = body.fen.split(' ')[1] === 'w' ? 1 : -1;
        const inLines = before.lines.find((l) => l.pv[0] === body.uci);
        const playedLine = inLines ?? (await engines.evaluate(played.fen, { depth: 14, multipv: 1 })).lines[0];
        const bestScore = scoreValue(best) * sign;
        const playedScore = playedLine ? scoreValue(playedLine) * sign : bestScore;
        const loss = Math.max(0, bestScore - playedScore);
        engine = { best: best.san[0] ?? '', bestScore: bestScore * sign, playedScore: playedScore * sign, loss, good: loss <= 0.5 };
      }
    } catch (error) {
      engineError = (error as Error).message;
    }
    return { san: played.san, answerMatch, engine, engineError };
  });
}

const cleanSan = (san: string) => san.replace(/[+#!?]/g, '');

/**
 * The first move of a written answer: "Bxh7+ Kxh7 Ng5+", "1. e4", "2... Qh4#" and "2. ... Qh4#" all
 * work. Move numbers and lone dots are not moves.
 */
export function firstAnswerMove(answer: string | null | undefined): string | undefined {
  return answer
    ?.trim()
    .split(/\s+/)
    .map((token) => token.replace(/^\d+\.+/, ''))
    .find((token) => token && !/^\.+$/.test(token));
}
