import { positionKey } from '@chess/chess-core';
import { type SQL, and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { type GameSummary, listGames } from './games.ts';
import { type SavedPosition, getSavedPosition } from './library.ts';
import { findOrCreatePosition } from './positions.ts';
import { getRepertoire } from './repertoire.ts';
import { CONCEPT_CATEGORIES, CONCEPT_LINK_TARGETS, conceptLinks, concepts, positions, repertoireMoves, savedPositions, taggings, tags } from './schema.ts';
import { setTags, tagsFor } from './tags.ts';

export type ConceptCategory = (typeof CONCEPT_CATEGORIES)[number];
export type ConceptLinkTarget = (typeof CONCEPT_LINK_TARGETS)[number];

export interface ConceptSummary {
  id: string;
  title: string;
  aliases: string[];
  category: ConceptCategory | null;
  tags: string[];
  updatedAt: string;
}

export interface ConceptPage extends ConceptSummary {
  bodyMd: string | null;
  keySigns: string[];
  related: ConceptSummary[];
  savedPositions: SavedPosition[];
  /** Positions linked directly (not through a save), with a FEN to show. */
  positions: { id: string; fen: string }[];
  games: GameSummary[];
  repertoireMoves: { id: string; san: string; repertoire: string; color: string; fen: string }[];
}

export interface ConceptInput {
  title: string;
  aliases?: string[];
  category?: ConceptCategory | null;
  bodyMd?: string | null;
  keySigns?: string[];
  tags?: string[];
}

const now = () => new Date().toISOString();
const contains = (value: string) => `%${value.replace(/[%_]/g, (c) => `\\${c}`)}%`;

const summaryColumns = {
  id: concepts.id,
  title: concepts.title,
  aliases: concepts.aliases,
  category: concepts.category,
  updatedAt: concepts.updatedAt,
};

function toSummaries(db: Db, rows: { id: string; title: string; aliases: string; category: ConceptCategory | null; updatedAt: string }[]): ConceptSummary[] {
  const tagMap = tagsFor(db, 'concept', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases) as string[], tags: tagMap.get(r.id) ?? [] }));
}

export function listConcepts(db: Db, f: { q?: string; category?: ConceptCategory; tag?: string } = {}): ConceptSummary[] {
  const where: SQL[] = [isNull(concepts.deletedAt)];
  if (f.q) {
    const q = contains(f.q);
    where.push(or(like(concepts.title, q), like(concepts.aliases, q), like(concepts.bodyMd, q), like(concepts.keySigns, q))!);
  }
  if (f.category) where.push(eq(concepts.category, f.category));
  if (f.tag) {
    where.push(
      inArray(
        concepts.id,
        db
          .select({ id: taggings.targetId })
          .from(taggings)
          .innerJoin(tags, eq(tags.id, taggings.tagId))
          .where(and(eq(taggings.targetType, 'concept'), eq(tags.name, f.tag.trim().toLowerCase()))),
      ),
    );
  }
  return toSummaries(db, db.select(summaryColumns).from(concepts).where(and(...where)).orderBy(concepts.title).all());
}

export function createConcept(db: Db, input: ConceptInput): ConceptSummary {
  const row = db
    .insert(concepts)
    .values({
      title: input.title.trim() || 'Untitled concept',
      aliases: JSON.stringify((input.aliases ?? []).map((a) => a.trim()).filter(Boolean)),
      category: input.category ?? null,
      bodyMd: input.bodyMd ?? null,
      keySigns: JSON.stringify((input.keySigns ?? []).map((k) => k.trim()).filter(Boolean)),
    })
    .returning(summaryColumns)
    .get();
  if (input.tags?.length) setTags(db, 'concept', row.id, input.tags);
  return toSummaries(db, [row])[0]!;
}

export function updateConcept(db: Db, id: string, input: Partial<ConceptInput>): void {
  const set: Partial<typeof concepts.$inferInsert> = { updatedAt: now() };
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.aliases) set.aliases = JSON.stringify(input.aliases.map((a) => a.trim()).filter(Boolean));
  if (input.category !== undefined) set.category = input.category;
  if (input.bodyMd !== undefined) set.bodyMd = input.bodyMd;
  if (input.keySigns) set.keySigns = JSON.stringify(input.keySigns.map((k) => k.trim()).filter(Boolean));
  db.update(concepts).set(set).where(eq(concepts.id, id)).run();
  if (input.tags) setTags(db, 'concept', id, input.tags);
}

/** Links a concept to something. A position can be given by FEN. */
export function linkConcept(db: Db, conceptId: string, targetType: ConceptLinkTarget, target: { id?: string; fen?: string }): void {
  const targetId = targetType === 'position' && target.fen ? findOrCreatePosition(db, target.fen).id : target.id;
  if (!targetId || (targetType === 'concept' && targetId === conceptId)) return;
  db.insert(conceptLinks).values({ conceptId, targetType, targetId }).onConflictDoNothing().run();
}

export function unlinkConcept(db: Db, conceptId: string, targetType: ConceptLinkTarget, targetId: string): void {
  db.delete(conceptLinks)
    .where(and(eq(conceptLinks.conceptId, conceptId), eq(conceptLinks.targetType, targetType), eq(conceptLinks.targetId, targetId)))
    .run();
  if (targetType === 'concept') {
    // Related concepts are linked both ways.
    db.delete(conceptLinks)
      .where(and(eq(conceptLinks.conceptId, targetId), eq(conceptLinks.targetType, 'concept'), eq(conceptLinks.targetId, conceptId)))
      .run();
  }
}

/** Concepts linked to one item. */
export function conceptsFor(db: Db, targetType: ConceptLinkTarget, targetId: string): ConceptSummary[] {
  const rows = db
    .select(summaryColumns)
    .from(conceptLinks)
    .innerJoin(concepts, eq(concepts.id, conceptLinks.conceptId))
    .where(and(eq(conceptLinks.targetType, targetType), eq(conceptLinks.targetId, targetId), isNull(concepts.deletedAt)))
    .orderBy(concepts.title)
    .all();
  return toSummaries(db, rows);
}

/** Concepts linked to a position, directly or through any save of it. */
export function conceptsAtPosition(db: Db, fen: string): ConceptSummary[] {
  const key = positionKey(fen);
  const position = db.select({ id: positions.id }).from(positions).where(eq(positions.fenKey, key)).get();
  if (!position) return [];
  const saves = db
    .select({ id: savedPositions.id })
    .from(savedPositions)
    .where(and(eq(savedPositions.positionId, position.id), isNull(savedPositions.deletedAt)))
    .all()
    .map((s) => s.id);
  const rows = db
    .selectDistinct(summaryColumns)
    .from(conceptLinks)
    .innerJoin(concepts, eq(concepts.id, conceptLinks.conceptId))
    .where(
      and(
        isNull(concepts.deletedAt),
        or(
          and(eq(conceptLinks.targetType, 'position'), eq(conceptLinks.targetId, position.id)),
          saves.length ? and(eq(conceptLinks.targetType, 'saved_position'), inArray(conceptLinks.targetId, saves)) : sql`0`,
        ),
      ),
    )
    .orderBy(concepts.title)
    .all();
  return toSummaries(db, rows);
}

export function getConcept(db: Db, id: string): ConceptPage | undefined {
  const row = db.select().from(concepts).where(and(eq(concepts.id, id), isNull(concepts.deletedAt))).get();
  if (!row) return undefined;
  const links = db.select().from(conceptLinks).where(eq(conceptLinks.conceptId, id)).all();
  const ids = (type: ConceptLinkTarget) => links.filter((l) => l.targetType === type).map((l) => l.targetId);
  const backLinks = db
    .select({ id: conceptLinks.conceptId })
    .from(conceptLinks)
    .where(and(eq(conceptLinks.targetType, 'concept'), eq(conceptLinks.targetId, id)))
    .all()
    .map((r) => r.id);
  const relatedIds = [...new Set([...ids('concept'), ...backLinks])];
  const related = relatedIds.length
    ? toSummaries(db, db.select(summaryColumns).from(concepts).where(and(inArray(concepts.id, relatedIds), isNull(concepts.deletedAt))).all())
    : [];
  const saved = ids('saved_position').map((s) => getSavedPosition(db, s)).filter((s): s is SavedPosition => !!s);
  const linkedPositions = ids('position').length
    ? db.select({ id: positions.id, fen: positions.fullFen }).from(positions).where(inArray(positions.id, ids('position'))).all()
    : [];
  const gameIds = new Set(ids('game'));
  const games = gameIds.size ? listGames(db, { limit: 500 }).games.filter((g) => gameIds.has(g.id)) : [];
  const moveRows = ids('repertoire_move').length
    ? db
        .select({ id: repertoireMoves.id, san: repertoireMoves.san, repertoireId: repertoireMoves.repertoireId, fen: positions.fullFen })
        .from(repertoireMoves)
        .innerJoin(positions, eq(positions.id, repertoireMoves.fromPositionId))
        .where(inArray(repertoireMoves.id, ids('repertoire_move')))
        .all()
    : [];
  return {
    id: row.id,
    title: row.title,
    aliases: JSON.parse(row.aliases) as string[],
    category: row.category,
    tags: tagsFor(db, 'concept', [id]).get(id) ?? [],
    updatedAt: row.updatedAt,
    bodyMd: row.bodyMd,
    keySigns: JSON.parse(row.keySigns) as string[],
    related,
    savedPositions: saved,
    positions: linkedPositions,
    games,
    repertoireMoves: moveRows.map((m) => {
      const rep = getRepertoire(db, m.repertoireId);
      return { id: m.id, san: m.san, repertoire: rep?.name ?? '', color: rep?.color ?? '', fen: m.fen };
    }),
  };
}

/** For the coach: concepts matching a query, best matches first, with a snippet of each page. */
export function searchConcepts(db: Db, query: string, limit = 8) {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  const candidates = new Map<string, ConceptSummary>();
  for (const q of [query, ...words]) for (const c of listConcepts(db, { q })) candidates.set(c.id, c);
  const scored = [...candidates.values()].map((c) => {
    const page = getConcept(db, c.id)!;
    const hay = [c.title, ...c.aliases].join(' ').toLowerCase();
    const score = (hay.includes(query.toLowerCase()) ? 10 : 0) + words.filter((w) => hay.includes(w)).length * 3 + words.filter((w) => (page.bodyMd ?? '').toLowerCase().includes(w)).length;
    return {
      score,
      concept: {
        id: c.id,
        title: c.title,
        aliases: c.aliases,
        category: c.category,
        keySigns: page.keySigns,
        snippet: (page.bodyMd ?? '').replace(/\s+/g, ' ').slice(0, 400),
        linkedPositions: page.savedPositions.length + page.positions.length,
      },
    };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.concept);
}

/** A random position linked to a concept, for the concept drill. */
export function drillPosition(db: Db, conceptId: string): { fen: string; title: string; answer: string | null; savedId: string | null } | null {
  const page = getConcept(db, conceptId);
  if (!page) return null;
  const options = [
    ...page.savedPositions.map((s) => ({ fen: s.fen, title: s.title, answer: s.answer, savedId: s.id })),
    ...page.positions.map((p) => ({ fen: p.fen, title: page.title, answer: null, savedId: null })),
  ];
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)]!;
}

/** Recently changed concepts, for Home and the palette. */
export function recentConcepts(db: Db, limit = 6): ConceptSummary[] {
  return toSummaries(db, db.select(summaryColumns).from(concepts).where(isNull(concepts.deletedAt)).orderBy(desc(concepts.updatedAt)).limit(limit).all());
}

