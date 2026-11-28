import { InvalidFenError, PgnParseError } from '@chess/chess-core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from '../db/client.ts';
import { countPositions } from '../db/positions.ts';
import { ImportSourceError } from './importers.ts';
import { libraryRoutes } from './routes/library.ts';
import { repertoireRoutes } from './routes/repertoire.ts';
import { engineRoutes } from './routes/engine.ts';
import { conceptRoutes } from './routes/concepts.ts';
import { coachRoutes } from './routes/coach.ts';
import type { StreamingClient } from '../coach/coach.ts';
import { EngineService } from './engineService.ts';
import { backupFolderFor } from '../db/backup.ts';
import { databasePath } from '../db/client.ts';

/** The API. Routes read and write only through apps/server/db. */
export function buildApp(
  db: Db,
  engines: EngineService = new EngineService(db),
  coachClient?: (apiKey: string) => StreamingClient,
  /** Where backups go; beside the database file unless given (tests give a temporary folder). */
  options: { backupFolder?: string } = {},
): FastifyInstance {
  // Large PGN files arrive in one request.
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 64 * 1024 * 1024 });

  // Only the app's own pages may use the API. A web page elsewhere cannot, not even through DNS
  // rebinding (a hostile name that resolves to 127.0.0.1): the Host must be a local name, and the
  // Origin, which browsers send with every write and every cross-site read, must be local too.
  app.addHook('onRequest', async (req, reply) => {
    if (!isLocalHost(req.headers.host)) return reply.code(403).send({ error: 'This server only answers Chess Workspace itself.' });
    const origin = req.headers.origin;
    if (origin !== undefined && !isLocalOrigin(origin)) return reply.code(403).send({ error: 'This server only answers Chess Workspace itself.' });
  });
  // Bodies are JSON; a plain-text body is what a cross-site form could send.
  app.removeContentTypeParser('text/plain');

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

  libraryRoutes(app, db, { backupFolder: options.backupFolder ?? backupFolderFor(databasePath()) });
  repertoireRoutes(app, db);
  engineRoutes(app, db, engines);
  conceptRoutes(app, db);
  coachRoutes(app, db, engines, coachClient);
  app.addHook('onClose', async () => engines.shutdown());
  return app;
}

const LOCAL_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** "127.0.0.1:47123", "localhost", "[::1]:5173" — never a name that only resolves to this machine. */
export function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  try {
    return LOCAL_NAMES.has(new URL(`http://${host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOCAL_NAMES.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}
