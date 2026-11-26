import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import {
  type ConceptCategory,
  type ConceptInput,
  type ConceptLinkTarget,
  conceptsAtPosition,
  conceptsFor,
  createConcept,
  drillPosition,
  getConcept,
  linkConcept,
  listConcepts,
  unlinkConcept,
  updateConcept,
} from '../../db/concepts.ts';
import { softDelete } from '../../db/library.ts';

/** Phase 5: the concepts library and its links both ways. */
export function conceptRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/concepts', async (req) => {
    const q = req.query as { q?: string; category?: ConceptCategory; tag?: string };
    return listConcepts(db, q);
  });
  app.get('/api/concepts/at', async (req) => conceptsAtPosition(db, (req.query as { fen: string }).fen));
  app.get('/api/concepts/for', async (req) => {
    const q = req.query as { targetType: ConceptLinkTarget; targetId: string };
    return conceptsFor(db, q.targetType, q.targetId);
  });
  app.get('/api/concepts/:id', async (req, reply) => {
    const page = getConcept(db, (req.params as { id: string }).id);
    return page ?? reply.code(404).send({ error: 'No such concept.' });
  });
  app.post('/api/concepts', async (req) => createConcept(db, req.body as ConceptInput));
  app.put('/api/concepts/:id', async (req) => {
    const { id } = req.params as { id: string };
    updateConcept(db, id, req.body as Partial<ConceptInput>);
    return getConcept(db, id);
  });
  app.delete('/api/concepts/:id', async (req) => {
    softDelete(db, 'concept', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/concepts/:id/links', async (req) => {
    const body = req.body as { targetType: ConceptLinkTarget; targetId?: string; fen?: string };
    linkConcept(db, (req.params as { id: string }).id, body.targetType, { id: body.targetId, fen: body.fen });
    return { ok: true };
  });
  app.post('/api/concepts/:id/links/remove', async (req) => {
    const body = req.body as { targetType: ConceptLinkTarget; targetId: string };
    unlinkConcept(db, (req.params as { id: string }).id, body.targetType, body.targetId);
    return { ok: true };
  });
  app.get('/api/concepts/:id/drill', async (req, reply) => {
    const position = drillPosition(db, (req.params as { id: string }).id);
    return position ?? reply.code(404).send({ error: 'This concept has no linked position to drill yet.' });
  });
}
