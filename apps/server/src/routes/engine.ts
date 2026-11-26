import { createGame, playMove } from '@chess/chess-core';
import { EngineError, scoreValue } from '@chess/chess-tools';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import { queue, review, stats, summary } from '../../db/training.ts';
import type { EngineService } from '../engineService.ts';

/** Phase 4: Stockfish analysis (live and cached) and spaced-repetition training. */
export function engineRoutes(app: FastifyInstance, db: Db, engines: EngineService): void {
  app.get('/api/engine/status', async () => engines.status());

  app.post('/api/engine/evaluate', async (req) => {
    const body = req.body as { fen: string; depth?: number; multipv?: number };
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
    const body = req.body as { cardId: string; rating: 1 | 2 | 3 | 4; correct: boolean };
    const card = review(db, body.cardId, body.rating, body.correct);
    return card ?? reply.code(404).send({ error: 'No such card.' });
  });

  app.get('/api/training/stats', async () => stats(db));

  /**
   * Checks a move played in solve mode: against the written answer, and
   * against Stockfish when it is set up (a move within half a pawn of the best
   * one counts as good).
   */
  app.post('/api/training/check', async (req) => {
    const body = req.body as { fen: string; uci: string; answer?: string | null };
    const played = playMove(createGame(body.fen).root, { from: body.uci.slice(0, 2), to: body.uci.slice(2, 4), promotion: body.uci[4] });
    const clean = (san: string) => san.replace(/[+#!?]/g, '');
    const firstAnswer = body.answer?.replace(/\d+\.(\.\.)?/g, ' ').trim().split(/\s+/)[0];
    const answerMatch = firstAnswer ? clean(firstAnswer) === clean(played.san) : null;
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
