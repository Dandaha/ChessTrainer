import { positionKey } from '@chess/chess-core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  COACH_MODELS,
  type CoachEvent,
  type CoachRequest,
  DEFAULT_DEEP_MODEL,
  DEFAULT_QUICK_MODEL,
  type StreamingClient,
  estimateCost,
  reviewGame,
  runCoach,
  sdkClient,
} from '../../coach/coach.ts';
import type { Db } from '../../db/client.ts';
import { historyAt, tokensSince } from '../../db/coach.ts';
import { getSettings } from '../../db/library.ts';
import type { EngineService } from '../engineService.ts';
import { writeEnvValue } from '../env.ts';
import { chessData } from '../toolData.ts';
import { bodies, parseBody } from '../validate.ts';
import { streamEvents } from '../events.ts';

export const NOT_CONNECTED = 'Coach not connected - add an API key in Settings';

const sse = (reply: FastifyReply, run: (emit: (e: CoachEvent) => void, signal: AbortSignal) => Promise<void>) =>
  streamEvents<CoachEvent>(reply, run);

/**
 * Phase 6: the in-app coach. It is off unless ANTHROPIC_API_KEY is set; the
 * key is written to apps/server/.env by the server and never sent back.
 * `clientFor` is replaceable so tests run without the network.
 */
export function coachRoutes(
  app: FastifyInstance,
  db: Db,
  engines: EngineService,
  clientFor: (apiKey: string) => StreamingClient = sdkClient,
): void {
  const deps = () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return {
      db,
      client: clientFor(key),
      tools: { analyse: (fen: string, o: { depth?: number; multipv?: number }) => engines.evaluate(fen, o), data: chessData(db) },
    };
  };

  app.get('/api/coach/status', async () => {
    const settings = getSettings(db);
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const month = tokensSince(db, monthStart).map((r) => ({
      model: r.model,
      answers: r.answers,
      input: r.input + r.cacheRead + r.cacheWrite,
      output: r.output,
      costUsd: estimateCost(r.model ?? '', { input: r.input, output: r.output, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite }),
    }));
    return {
      connected: Boolean(process.env.ANTHROPIC_API_KEY),
      message: process.env.ANTHROPIC_API_KEY ? null : NOT_CONNECTED,
      models: COACH_MODELS,
      quickModel: settings.coachQuickModel ?? DEFAULT_QUICK_MODEL,
      deepModel: settings.coachDeepModel ?? DEFAULT_DEEP_MODEL,
      month,
    };
  });

  app.put('/api/coach/key', async (req, reply) => {
    const { apiKey } = parseBody(bodies.coachKey, req.body);
    const key = apiKey?.trim() ?? '';
    if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) return reply.code(400).send({ error: 'That does not look like a Claude API key (they start with sk-ant-).' });
    writeEnvValue('ANTHROPIC_API_KEY', key);
    return { connected: true };
  });

  app.delete('/api/coach/key', async () => {
    writeEnvValue('ANTHROPIC_API_KEY', null);
    return { connected: false };
  });

  app.get('/api/coach/history', async (req) => historyAt(db, (req.query as { fen: string }).fen, positionKey));

  app.post('/api/coach/ask', async (req, reply) => {
    const body = req.body as CoachRequest;
    const d = deps();
    if (!d) return reply.code(409).send({ error: NOT_CONNECTED });
    await sse(reply, (emit, signal) => runCoach({ ...d, signal }, body, emit));
  });

  app.post('/api/coach/review', async (req, reply) => {
    const body = parseBody(bodies.coachReview, req.body);
    const d = deps();
    if (!d) return reply.code(409).send({ error: NOT_CONNECTED });
    await sse(reply, (emit, signal) => reviewGame({ ...d, signal }, body, emit));
  });
}
