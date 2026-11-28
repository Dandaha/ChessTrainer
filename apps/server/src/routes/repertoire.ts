import {
  START_FEN,
  checkGame,
  describeCheck,
  edgesByFrom,
  edgesFromGame,
  opponentPositions,
  parseGame,
  parsePgn,
  positionKey,
  repertoireToGame,
  writePgn,
} from '@chess/chess-core';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import { getSettings, softDelete } from '../../db/library.ts';
import {
  NOT_CONNECTED,
  addEdges,
  addLine,
  createRepertoire,
  deleteMove,
  getEdges,
  getRepertoire,
  listRepertoires,
  reachedPositions,
  renameRepertoire,
  repertoiresAt,
  updateMove,
} from '../../db/repertoire.ts';
import { type ExplorerMove, explore, ratingsAround } from '../explorer.ts';
import { bodies, parseBody } from '../validate.ts';

/** Phase 3: repertoires, their moves, PGN import/export, game check and gap finder. */
export function repertoireRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/repertoires', async () => listRepertoires(db));
  app.post('/api/repertoires', async (req) => ({ id: createRepertoire(db, parseBody(bodies.repertoire, req.body)) }));
  app.put('/api/repertoires/:id', async (req) => {
    renameRepertoire(db, (req.params as { id: string }).id, parseBody(bodies.name, req.body).name);
    return { ok: true };
  });
  app.delete('/api/repertoires/:id', async (req) => {
    softDelete(db, 'repertoire', [(req.params as { id: string }).id]);
    return { ok: true };
  });

  app.get('/api/repertoires/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repertoire = getRepertoire(db, id);
    if (!repertoire) return reply.code(404).send({ error: 'No such repertoire.' });
    return { repertoire, edges: getEdges(db, id), startFen: START_FEN };
  });

  app.post('/api/repertoires/:id/line', async (req) => {
    const body = parseBody(bodies.line, req.body);
    return addLine(db, (req.params as { id: string }).id, body.fen ?? START_FEN, body.sans);
  });

  app.post('/api/repertoires/:id/import', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repertoire = getRepertoire(db, id);
    if (!repertoire) return reply.code(404).send({ error: 'No such repertoire.' });
    const { games, errors } = parsePgn(parseBody(bodies.pgn, req.body).pgn);
    // A game (or study chapter) must start where the repertoire, or an earlier game in the file, reaches.
    const reached = reachedPositions(db, id);
    const unreadable = new Set(errors.map((e) => e.gameIndex));
    let index = -1;
    const edges = games.flatMap((game) => {
      do index += 1;
      while (unreadable.has(index));
      if (!reached.has(positionKey(game.root.fen))) {
        errors.push({ gameIndex: index, line: 0, message: `Game ${index + 1} ${NOT_CONNECTED}` });
        return [];
      }
      const moves = edgesFromGame(game, repertoire.color);
      for (const move of moves) reached.add(positionKey(move.toFen));
      return moves;
    });
    const result = addEdges(db, id, edges);
    errors.sort((a, b) => a.gameIndex - b.gameIndex);
    return { ...result, games: games.length, errors };
  });

  app.get('/api/repertoires/:id/export', async (req, reply) => {
    const { id } = req.params as { id: string };
    const repertoire = getRepertoire(db, id);
    if (!repertoire) return reply.code(404).send({ error: 'No such repertoire.' });
    const game = repertoireToGame(getEdges(db, id));
    game.headers = game.headers.map((h) => (h.name === 'Event' ? { ...h, value: `${repertoire.name} (${repertoire.color})` } : h));
    return { pgn: writePgn(game) };
  });

  app.put('/api/repertoire-moves/:id', async (req) => {
    updateMove(db, (req.params as { id: string }).id, parseBody(bodies.repertoireMove, req.body));
    return { ok: true };
  });
  app.delete('/api/repertoire-moves/:id', async (req) => ({ deleted: deleteMove(db, (req.params as { id: string }).id) }));

  app.get('/api/repertoires/at', async (req) => repertoiresAt(db, (req.query as { fen: string }).fen));

  /** Where a game (as PGN) left each repertoire of the right colour. */
  app.post('/api/repertoires/check', async (req) => {
    const body = parseBody(bodies.gameCheck, req.body);
    const game = parseGame(body.pgn);
    return listRepertoires(db)
      .filter((r) => !body.color || r.color === body.color)
      .map((repertoire) => {
        const result = checkGame(game, getEdges(db, repertoire.id), repertoire.color);
        return { repertoire, result, message: describeCheck(result) };
      })
      .filter((r) => r.result.kind !== 'not-in-repertoire' && !(r.result.kind === 'followed' && r.result.plies === 0));
  });

  /** Common opponent replies the repertoire does not answer, from the Lichess explorer. */
  app.get('/api/repertoires/:id/gaps', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { minShare?: string; maxPositions?: string };
    const repertoire = getRepertoire(db, id);
    if (!repertoire) return reply.code(404).send({ error: 'No such repertoire.' });
    const minShare = Number(q.minShare ?? 0.05);
    const maxPositions = Math.min(Number(q.maxPositions ?? 25), 60);
    const edges = getEdges(db, id);
    const byFrom = edgesByFrom(edges);
    const ratings = ratingsAround(getSettings(db).rating);
    const gaps: { fen: string; ply: number; total: number; move: ExplorerMove; share: number }[] = [];
    let checked = 0;
    for (const position of opponentPositions(edges, repertoire.color).slice(0, maxPositions)) {
      const result = await explore(position.fen, { ratings });
      checked += 1;
      const total = result.white + result.draws + result.black;
      const known = new Set((byFrom.get(positionKey(position.fen)) ?? []).map((e) => e.uci));
      for (const move of result.moves) {
        const count = move.white + move.draws + move.black;
        const share = total ? count / total : 0;
        if (share >= minShare && !known.has(move.uci)) gaps.push({ fen: position.fen, ply: position.ply, total, move, share });
      }
      await new Promise((r) => setTimeout(r, 250)); // be gentle with the explorer
    }
    return { checked, gaps: gaps.sort((a, b) => a.ply - b.ply || b.share - a.share) };
  });
}
