import { InvalidFenError, PgnParseError } from '@chess/chess-core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import { countPositions } from '../db/positions.ts';
import { ImportSourceError } from './importers.ts';
import { libraryRoutes } from './routes/library.ts';

/** The API. Routes read and write only through apps/server/db. */
export function buildApp(db: Db): FastifyInstance {
  // Large PGN files arrive in one request.
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 * 1024 });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ImportSourceError) return reply.code(error.status).send({ error: error.message });
    if (error instanceof PgnParseError || error instanceof InvalidFenError) {
      return reply.code(400).send({ error: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(error);
    return reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server.' : (error as Error).message });
  });

  app.get('/api/health', async () => ({
    ok: true,
    database: { positions: countPositions(db) },
  }));

  libraryRoutes(app, db);
  return app;
}
