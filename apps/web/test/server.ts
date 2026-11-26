import { openDatabase, runMigrations } from '@chess/server/db/client.ts';
import { buildApp } from '@chess/server/src/app.ts';
import type { StreamingClient } from '@chess/server/coach/coach.ts';
import { afterEach, vi } from 'vitest';

/**
 * Runs the real API in memory and routes the app's fetch('/api/...') calls to
 * it, so UI tests exercise the server and the database too.
 */
export function startServer(options: { coachClient?: StreamingClient } = {}) {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  const app = buildApp(db, undefined, options.coachClient ? () => options.coachClient! : undefined);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const response = await app.inject({
      method: (init?.method ?? 'GET') as 'GET',
      url,
      headers: init?.headers as Record<string, string>,
      payload: init?.body as string | undefined,
    });
    return new Response(response.body, { status: response.statusCode, headers: { 'Content-Type': 'application/json' } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    void app.close();
  });
  return { db, app };
}
