import type { FastifyInstance } from 'fastify';
import { writeEnvValue } from '../env.ts';
import { bodies, parseBody } from '../validate.ts';

/**
 * The personal Lichess token, which the opening explorer (Find gaps, opening statistics) needs. Like
 * the Claude key it lives only in the .env file in the data folder and is never sent back; Lichess is
 * asked whether it works before it is kept.
 */
export function lichessRoutes(app: FastifyInstance): void {
  app.get('/api/lichess/token', async () => ({ connected: Boolean(process.env.LICHESS_TOKEN) }));

  app.put('/api/lichess/token', async (req, reply) => {
    const token = parseBody(bodies.lichessToken, req.body).token.trim();
    if (!/^lip_[A-Za-z0-9]{10,}$/.test(token)) {
      return reply.code(400).send({ error: 'That does not look like a Lichess token (they start with lip_).' });
    }
    let response: Response;
    try {
      response = await fetch('https://lichess.org/api/account', {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'chess-workspace (personal use)' },
      });
    } catch {
      return reply.code(502).send({ error: 'Could not reach Lichess to check the token. Check the internet connection.' });
    }
    if (response.status === 401) return reply.code(400).send({ error: 'Lichess did not accept this token.' });
    if (!response.ok) return reply.code(502).send({ error: `Lichess answered ${response.status}.` });
    const account = (await response.json()) as { username?: string };
    writeEnvValue('LICHESS_TOKEN', token);
    return { connected: true, username: account.username ?? null };
  });

  app.delete('/api/lichess/token', async () => {
    writeEnvValue('LICHESS_TOKEN', null);
    return { connected: false };
  });
}
