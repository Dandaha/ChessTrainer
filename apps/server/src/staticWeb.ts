import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serves the built web app (apps/web/dist) from the API server, so the
 * desktop app needs one local server only. Unknown paths get index.html;
 * unknown /api paths get a 404.
 */
export function serveWeb(app: FastifyInstance, webDir: string): void {
  const root = resolve(webDir);
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent((req.url.split('?')[0] ?? '/').replace(/^\/+/, ''));
    if (path.startsWith('api/')) return reply.code(404).send({ error: 'No such API route.' });
    let file = resolve(root, path || 'index.html');
    if (file !== root && !file.startsWith(root + sep)) return reply.code(404).send();
    try {
      if (!(await stat(file)).isFile()) file = resolve(root, 'index.html');
    } catch {
      file = resolve(root, 'index.html');
    }
    const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const body = await readFile(file);
    return reply
      .header('Content-Type', type)
      .header('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(body);
  });
}
