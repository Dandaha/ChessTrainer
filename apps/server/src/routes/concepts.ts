import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.ts';
import {
  type ConceptCategory,
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
import { createCategory, deleteCategory, listCategories, renameCategory } from '../../db/categories.ts';
import { addStarterConcepts, missingStarterConcepts } from '../../db/starterLibrary.ts';
import { bodies, parseBody } from '../validate.ts';

/** Phase 5: the concepts library and its links both ways. */
export function conceptRoutes(app: FastifyInstance, db: Db): void {
  // The built-in concepts, for any the library is missing (they are added once at start-up anyway).
  app.get('/api/concepts/starter', async () => ({ missing: missingStarterConcepts(db) }));
  app.post('/api/concepts/starter', async () => ({ added: addStarterConcepts(db) }));

  // Concept categories: the person's own list, as for saved positions.
  app.get('/api/concept-categories', async () => listCategories(db, 'concept'));
  app.post('/api/concept-categories', async (req) => createCategory(db, 'concept', parseBody(bodies.name, req.body).name));
  app.put('/api/concept-categories/:id', async (req, reply) => {
    const category = renameCategory(db, 'concept', (req.params as { id: string }).id, parseBody(bodies.name, req.body).name);
    return category ?? reply.code(404).send({ error: 'No such category.' });
  });
  app.delete('/api/concept-categories/:id', async (req, reply) => {
    const result = deleteCategory(db, 'concept', (req.params as { id: string }).id);
    return result.removed ? result : reply.code(404).send({ error: 'No such category.' });
  });

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
  app.post('/api/concepts', async (req) => createConcept(db, parseBody(bodies.concept, req.body)));
  app.put('/api/concepts/:id', async (req) => {
    const { id } = req.params as { id: string };
    updateConcept(db, id, parseBody(bodies.conceptUpdate, req.body));
    return getConcept(db, id);
  });
  app.delete('/api/concepts/:id', async (req) => {
    softDelete(db, 'concept', [(req.params as { id: string }).id]);
    return { ok: true };
  });
  app.post('/api/concepts/:id/links', async (req) => {
    const body = parseBody(bodies.conceptLink, req.body);
    linkConcept(db, (req.params as { id: string }).id, body.targetType, { id: body.targetId, fen: body.fen });
    return { ok: true };
  });
  app.post('/api/concepts/:id/links/remove', async (req) => {
    const body = parseBody(bodies.conceptUnlink, req.body);
    unlinkConcept(db, (req.params as { id: string }).id, body.targetType, body.targetId);
    return { ok: true };
  });
  app.get('/api/concepts/:id/drill', async (req, reply) => {
    const position = drillPosition(db, (req.params as { id: string }).id);
    return position ?? reply.code(404).send({ error: 'This concept has no linked position to drill yet.' });
  });
}
