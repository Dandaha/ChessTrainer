import { positionKey } from '@chess/chess-core';
import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { findOrCreatePosition } from './positions.ts';
import {
  POSITION_CATEGORIES,
  collectionGames,
  collections,
  concepts,
  games,
  positionSetItems,
  positionSets,
  repertoires,
  savedPositions,
  settings,
  taggings,
  tags,
} from './schema.ts';
import { dropTaggings, setTags, tagsFor } from './tags.ts';

/**
 * Collections of games, saved positions, position sets, settings and the
 * trash. Deleting moves a row to the trash; it is purged after 30 days.
 */

const now = () => new Date().toISOString();
const contains = (value: string) => `%${value.replace(/[%_]/g, (c) => `\\${c}`)}%`;

// --- Collections -------------------------------------------------------------

export interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  games: number;
}

export function listCollections(db: Db): CollectionSummary[] {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      games: sql<number>`(select count(*) from collection_games cg join games g on g.id = cg.game_id where cg.collection_id = collections.id and g.deleted_at is null)`,
    })
    .from(collections)
    .where(isNull(collections.deletedAt))
    .orderBy(collections.name)
    .all();
}

export function createCollection(db: Db, input: { name: string; description?: string | null }): string {
  return db
    .insert(collections)
    .values({ name: input.name.trim(), description: input.description ?? null })
    .returning({ id: collections.id })
    .get().id;
}

export function updateCollection(db: Db, id: string, input: { name?: string; description?: string | null }): void {
  db.update(collections)
    .set({ ...input, ...(input.name ? { name: input.name.trim() } : {}), updatedAt: now() })
    .where(eq(collections.id, id))
    .run();
}

export function addGamesToCollection(db: Db, collectionId: string, gameIds: string[]): void {
  const start =
    db
      .select({ n: sql<number>`coalesce(max(${collectionGames.sortOrder}), 0)` })
      .from(collectionGames)
      .where(eq(collectionGames.collectionId, collectionId))
      .get()?.n ?? 0;
  gameIds.forEach((gameId, i) => {
    db.insert(collectionGames).values({ collectionId, gameId, sortOrder: start + i + 1 }).onConflictDoNothing().run();
  });
}

export function removeGamesFromCollection(db: Db, collectionId: string, gameIds: string[]): void {
  db.delete(collectionGames)
    .where(and(eq(collectionGames.collectionId, collectionId), inArray(collectionGames.gameId, gameIds)))
    .run();
}

// --- Saved positions ---------------------------------------------------------

export type Category = (typeof POSITION_CATEGORIES)[number];

export interface SavedPosition {
  id: string;
  positionId: string;
  fen: string;
  title: string;
  notesMd: string | null;
  category: Category | null;
  keyIdea: string | null;
  answer: string | null;
  sideToSolve: 'white' | 'black';
  difficulty: number | null;
  inTraining: boolean;
  sourceGameId: string | null;
  sourcePly: number | null;
  sourceLabel: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  setIds: string[];
}

export interface SavedPositionInput {
  fen: string;
  title: string;
  notesMd?: string | null;
  category?: Category | null;
  keyIdea?: string | null;
  answer?: string | null;
  sideToSolve?: 'white' | 'black';
  difficulty?: number | null;
  inTraining?: boolean;
  sourceGameId?: string | null;
  sourcePly?: number | null;
  sourceLabel?: string | null;
  tags?: string[];
  setIds?: string[];
}

export interface SavedPositionFilters {
  q?: string;
  category?: Category;
  tag?: string;
  setId?: string;
  inTraining?: boolean;
  /** 'game': saved from a library game; 'other': pasted or played. */
  source?: 'game' | 'other';
  /** Only saves of this position. */
  fen?: string;
  /** Only saves created on or after this ISO date. */
  since?: string;
  limit?: number;
  offset?: number;
}

const savedColumns = {
  id: savedPositions.id,
  positionId: savedPositions.positionId,
  fen: savedPositions.fen,
  title: savedPositions.title,
  notesMd: savedPositions.notesMd,
  category: savedPositions.category,
  keyIdea: savedPositions.keyIdea,
  answer: savedPositions.answer,
  sideToSolve: savedPositions.sideToSolve,
  difficulty: savedPositions.difficulty,
  inTraining: savedPositions.inTraining,
  sourceGameId: savedPositions.sourceGameId,
  sourcePly: savedPositions.sourcePly,
  sourceLabel: savedPositions.sourceLabel,
  createdAt: savedPositions.createdAt,
  updatedAt: savedPositions.updatedAt,
};

function withTagsAndSets(db: Db, rows: Omit<SavedPosition, 'tags' | 'setIds'>[]): SavedPosition[] {
  const ids = rows.map((r) => r.id);
  const tagMap = tagsFor(db, 'saved_position', ids);
  const setRows = ids.length
    ? db
        .select({ savedId: positionSetItems.savedPositionId, setId: positionSetItems.setId })
        .from(positionSetItems)
        .innerJoin(positionSets, eq(positionSets.id, positionSetItems.setId))
        .where(and(inArray(positionSetItems.savedPositionId, ids), isNull(positionSets.deletedAt)))
        .all()
    : [];
  return rows.map((r) => ({
    ...r,
    tags: tagMap.get(r.id) ?? [],
    setIds: setRows.filter((s) => s.savedId === r.id).map((s) => s.setId),
  }));
}

function addToSets(db: Db, savedId: string, setIds: string[]): void {
  for (const setId of setIds) {
    const order =
      db
        .select({ n: sql<number>`coalesce(max(${positionSetItems.sortOrder}), 0)` })
        .from(positionSetItems)
        .where(eq(positionSetItems.setId, setId))
        .get()?.n ?? 0;
    db.insert(positionSetItems).values({ setId, savedPositionId: savedId, sortOrder: order + 1 }).onConflictDoNothing().run();
  }
}

export function createSavedPosition(db: Db, input: SavedPositionInput): SavedPosition {
  const position = findOrCreatePosition(db, input.fen);
  const turn = input.fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
  const id = db.transaction((tx) => {
    const row = tx
      .insert(savedPositions)
      .values({
        positionId: position.id,
        fen: input.fen.trim(),
        title: input.title.trim() || 'Untitled position',
        notesMd: input.notesMd ?? null,
        category: input.category ?? null,
        keyIdea: input.keyIdea ?? null,
        answer: input.answer ?? null,
        sideToSolve: input.sideToSolve ?? turn,
        difficulty: input.difficulty ?? null,
        inTraining: input.inTraining ?? false,
        sourceGameId: input.sourceGameId ?? null,
        sourcePly: input.sourcePly ?? null,
        sourceLabel: input.sourceLabel ?? null,
      })
      .returning({ id: savedPositions.id })
      .get();
    if (input.tags?.length) setTags(tx as unknown as Db, 'saved_position', row.id, input.tags);
    if (input.setIds?.length) addToSets(tx as unknown as Db, row.id, input.setIds);
    return row.id;
  });
  return getSavedPosition(db, id)!;
}

export function updateSavedPosition(db: Db, id: string, input: Partial<Omit<SavedPositionInput, 'fen'>>): SavedPosition | undefined {
  const { tags: tagNames, setIds, ...fields } = input;
  db.update(savedPositions).set({ ...fields, updatedAt: now() }).where(eq(savedPositions.id, id)).run();
  if (tagNames) setTags(db, 'saved_position', id, tagNames);
  if (setIds) {
    db.delete(positionSetItems)
      .where(and(eq(positionSetItems.savedPositionId, id), setIds.length ? notInArray(positionSetItems.setId, setIds) : undefined))
      .run();
    addToSets(db, id, setIds);
  }
  return getSavedPosition(db, id);
}

export function getSavedPosition(db: Db, id: string): SavedPosition | undefined {
  const row = db.select(savedColumns).from(savedPositions).where(and(eq(savedPositions.id, id), isNull(savedPositions.deletedAt))).get();
  return row ? withTagsAndSets(db, [row])[0] : undefined;
}

export function listSavedPositions(db: Db, f: SavedPositionFilters = {}): { total: number; positions: SavedPosition[] } {
  const where: SQL[] = [isNull(savedPositions.deletedAt)];
  if (f.q) {
    const q = contains(f.q);
    where.push(
      or(
        like(savedPositions.title, q),
        like(savedPositions.notesMd, q),
        like(savedPositions.keyIdea, q),
        like(savedPositions.sourceLabel, q),
        inArray(
          savedPositions.id,
          db
            .select({ id: taggings.targetId })
            .from(taggings)
            .innerJoin(tags, eq(tags.id, taggings.tagId))
            .where(and(eq(taggings.targetType, 'saved_position'), like(tags.name, q))),
        ),
      )!,
    );
  }
  if (f.category) where.push(eq(savedPositions.category, f.category));
  if (f.inTraining !== undefined) where.push(eq(savedPositions.inTraining, f.inTraining));
  if (f.source === 'game') where.push(isNotNull(savedPositions.sourceGameId));
  if (f.source === 'other') where.push(isNull(savedPositions.sourceGameId));
  if (f.since) where.push(sql`${savedPositions.createdAt} >= ${f.since}`);
  if (f.fen) where.push(sql`${savedPositions.positionId} = (select id from positions where fen_key = ${positionKey(f.fen)})`);
  if (f.tag) {
    where.push(
      inArray(
        savedPositions.id,
        db
          .select({ id: taggings.targetId })
          .from(taggings)
          .innerJoin(tags, eq(tags.id, taggings.tagId))
          .where(and(eq(taggings.targetType, 'saved_position'), eq(tags.name, f.tag.trim().toLowerCase()))),
      ),
    );
  }
  if (f.setId) {
    where.push(
      inArray(
        savedPositions.id,
        db.select({ id: positionSetItems.savedPositionId }).from(positionSetItems).where(eq(positionSetItems.setId, f.setId)),
      ),
    );
  }
  const total = db.select({ n: sql<number>`count(*)` }).from(savedPositions).where(and(...where)).get()?.n ?? 0;
  const order = f.setId
    ? [
        asc(
          sql`(select i.sort_order from position_set_items i where i.saved_position_id = saved_positions.id and i.set_id = ${f.setId})`,
        ),
      ]
    : [desc(savedPositions.createdAt)];
  const rows = db
    .select(savedColumns)
    .from(savedPositions)
    .where(and(...where))
    .orderBy(...order)
    .limit(Math.min(f.limit ?? 60, 500))
    .offset(f.offset ?? 0)
    .all();
  return { total, positions: withTagsAndSets(db, rows) };
}

// --- Position sets -----------------------------------------------------------

export interface PositionSetSummary {
  id: string;
  name: string;
  description: string | null;
  positions: number;
}

export function listSets(db: Db): PositionSetSummary[] {
  return db
    .select({
      id: positionSets.id,
      name: positionSets.name,
      description: positionSets.description,
      positions: sql<number>`(select count(*) from position_set_items i join saved_positions s on s.id = i.saved_position_id where i.set_id = position_sets.id and s.deleted_at is null)`,
    })
    .from(positionSets)
    .where(isNull(positionSets.deletedAt))
    .orderBy(positionSets.name)
    .all();
}

export function createSet(db: Db, input: { name: string; description?: string | null }): string {
  return db
    .insert(positionSets)
    .values({ name: input.name.trim(), description: input.description ?? null })
    .returning({ id: positionSets.id })
    .get().id;
}

export function updateSet(db: Db, id: string, input: { name?: string; description?: string | null }): void {
  db.update(positionSets).set({ ...input, updatedAt: now() }).where(eq(positionSets.id, id)).run();
}

export function addToSet(db: Db, setId: string, savedIds: string[]): void {
  for (const id of savedIds) addToSets(db, id, [setId]);
}

export function removeFromSet(db: Db, setId: string, savedIds: string[]): void {
  db.delete(positionSetItems)
    .where(and(eq(positionSetItems.setId, setId), inArray(positionSetItems.savedPositionId, savedIds)))
    .run();
}

/** Puts a set's positions in this order. */
export function reorderSet(db: Db, setId: string, savedIds: string[]): void {
  db.transaction((tx) => {
    savedIds.forEach((id, i) => {
      tx.update(positionSetItems)
        .set({ sortOrder: i + 1 })
        .where(and(eq(positionSetItems.setId, setId), eq(positionSetItems.savedPositionId, id)))
        .run();
    });
  });
}

// --- Settings ----------------------------------------------------------------

/** Settings the browser may read and change. The API key is not one of them. */
export interface Settings {
  lichessUsername?: string;
  chesscomUsername?: string;
  rating?: number;
  [key: string]: unknown;
}

export function getSettings(db: Db): Settings {
  const out: Settings = {};
  for (const row of db.select().from(settings).all()) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      out[row.key] = row.value;
    }
  }
  return out;
}

export function updateSettings(db: Db, values: Settings): Settings {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') {
      db.delete(settings).where(eq(settings.key, key)).run();
    } else {
      const json = JSON.stringify(value);
      db.insert(settings).values({ key, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } }).run();
    }
  }
  return getSettings(db);
}

// --- Trash -------------------------------------------------------------------

export type TrashKind = 'game' | 'saved_position' | 'position_set' | 'collection' | 'repertoire' | 'concept';

const TRASH_TABLES = {
  game: games,
  saved_position: savedPositions,
  position_set: positionSets,
  collection: collections,
  repertoire: repertoires,
  concept: concepts,
} as const;

export interface TrashItem {
  kind: TrashKind;
  id: string;
  label: string;
  deletedAt: string;
}

export function softDelete(db: Db, kind: TrashKind, ids: string[]): void {
  if (!ids.length) return;
  const table = TRASH_TABLES[kind];
  db.update(table).set({ deletedAt: now() }).where(inArray(table.id, ids)).run();
}

export function restore(db: Db, kind: TrashKind, id: string): void {
  const table = TRASH_TABLES[kind];
  db.update(table).set({ deletedAt: null }).where(eq(table.id, id)).run();
}

export function listTrash(db: Db): TrashItem[] {
  const items: TrashItem[] = [
    ...db
      .select({ id: games.id, white: games.white, black: games.black, date: games.date, deletedAt: games.deletedAt })
      .from(games)
      .where(isNotNull(games.deletedAt))
      .all()
      .map((g) => ({
        kind: 'game' as const,
        id: g.id,
        label: `${g.white ?? '?'} – ${g.black ?? '?'}${g.date ? `, ${g.date.slice(0, 4)}` : ''}`,
        deletedAt: g.deletedAt!,
      })),
    ...db
      .select({ id: savedPositions.id, label: savedPositions.title, deletedAt: savedPositions.deletedAt })
      .from(savedPositions)
      .where(isNotNull(savedPositions.deletedAt))
      .all()
      .map((r) => ({ kind: 'saved_position' as const, id: r.id, label: r.label, deletedAt: r.deletedAt! })),
    ...db
      .select({ id: positionSets.id, label: positionSets.name, deletedAt: positionSets.deletedAt })
      .from(positionSets)
      .where(isNotNull(positionSets.deletedAt))
      .all()
      .map((r) => ({ kind: 'position_set' as const, id: r.id, label: r.label, deletedAt: r.deletedAt! })),
    ...db
      .select({ id: collections.id, label: collections.name, deletedAt: collections.deletedAt })
      .from(collections)
      .where(isNotNull(collections.deletedAt))
      .all()
      .map((r) => ({ kind: 'collection' as const, id: r.id, label: r.label, deletedAt: r.deletedAt! })),
    ...db
      .select({ id: repertoires.id, label: repertoires.name, deletedAt: repertoires.deletedAt })
      .from(repertoires)
      .where(isNotNull(repertoires.deletedAt))
      .all()
      .map((r) => ({ kind: 'repertoire' as const, id: r.id, label: r.label, deletedAt: r.deletedAt! })),
    ...db
      .select({ id: concepts.id, label: concepts.title, deletedAt: concepts.deletedAt })
      .from(concepts)
      .where(isNotNull(concepts.deletedAt))
      .all()
      .map((r) => ({ kind: 'concept' as const, id: r.id, label: r.label, deletedAt: r.deletedAt! })),
  ];
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Deletes for good whatever has been in the trash longer than this many days. */
export function purgeTrash(db: Db, olderThanDays = 30): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  let purged = 0;
  db.transaction((tx) => {
    const gone = (rows: { id: string }[]) => rows.map((r) => r.id);
    const gameIds = gone(tx.select({ id: games.id }).from(games).where(lt(games.deletedAt, cutoff)).all());
    const savedIds = gone(tx.select({ id: savedPositions.id }).from(savedPositions).where(lt(savedPositions.deletedAt, cutoff)).all());
    dropTaggings(tx as unknown as Db, 'game', gameIds);
    dropTaggings(tx as unknown as Db, 'saved_position', savedIds);
    for (const table of Object.values(TRASH_TABLES)) {
      purged += tx.delete(table).where(lt(table.deletedAt, cutoff)).run().changes;
    }
  });
  return purged;
}

/** Positions this one was saved as before, newest first (for the "saved before" hint). */
export function savesOfPosition(db: Db, fen: string, exceptId?: string): { id: string; title: string; createdAt: string }[] {
  const key = positionKey(fen);
  return db
    .select({ id: savedPositions.id, title: savedPositions.title, createdAt: savedPositions.createdAt })
    .from(savedPositions)
    .where(
      and(
        isNull(savedPositions.deletedAt),
        sql`${savedPositions.positionId} = (select id from positions where fen_key = ${key})`,
        exceptId ? ne(savedPositions.id, exceptId) : undefined,
      ),
    )
    .orderBy(desc(savedPositions.createdAt))
    .all();
}
