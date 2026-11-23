import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import { countPositions } from '../db/positions.ts';

/** The API. Routes read and write only through apps/server/db. */
export function buildApp(db: Db): FastifyInstance {
  const app = Fastify({ logger: { level: 'warn' } });

  app.get('/api/health', async () => ({
    ok: true,
    database: { positions: countPositions(db) },
  }));

  return app;
}
