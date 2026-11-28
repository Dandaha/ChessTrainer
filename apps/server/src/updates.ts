import type { FastifyInstance } from 'fastify';

/**
 * The installed app's updates, as the desktop app reports them: the server only passes them on to
 * Settings. The desktop app adds these routes (like the built pages); run from source, there are
 * none, and Settings shows no Updates section.
 */

export type UpdateStatus =
  /** Not the installed app (the desktop app run from source): there is nothing to update from. */
  | { state: 'unavailable' }
  /** Not checked yet since the app opened. */
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date'; checkedAt: string }
  | { state: 'downloading'; version: string; percent: number }
  /** Downloaded: a restart switches to it, and closing the app installs it anyway. */
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string; checkedAt: string };

export interface Updates {
  /** The running version, e.g. "0.1.35". */
  version: string;
  status(): UpdateStatus;
  /** Looks for a new version now; nothing happens while one is being checked or downloaded, or is ready. */
  check(): void;
  /** Restarts into the downloaded version. */
  restart(): void;
}

export interface UpdateInfo {
  version: string;
  status: UpdateStatus;
}

/** An updater error in a sentence for Settings: a network failure as such, anything else by its first line. */
export function plainUpdateError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_PROXY|ERR_TIMED_OUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(text)) {
    return 'GitHub could not be reached. Is the computer online?';
  }
  const first = (text.split('\n')[0] ?? '').trim() || 'Unknown error.';
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

export function updateRoutes(app: FastifyInstance, updates: Updates): void {
  const info = (): UpdateInfo => ({ version: updates.version, status: updates.status() });
  app.get('/api/system/updates', async () => info());
  app.post('/api/system/updates/check', async () => {
    updates.check();
    return info();
  });
  app.post('/api/system/updates/restart', async (_req, reply) => {
    if (updates.status().state !== 'ready') return reply.code(409).send({ error: 'No update is ready yet.' });
    // Once the answer is on its way: the app closes this server as it quits.
    setTimeout(() => updates.restart(), 100);
    return { ok: true };
  });
}
