import { positionKey } from '@chess/chess-core';
import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { findOrCreatePosition } from './positions.ts';
import {
  collectionGames,
  collections,
  conceptLinks,
  concepts,
  games,
  positionSetItems,
  positionSets,
  repertoireMoves,
  repertoires,
  savedPositions,
  settings,
  taggings,
  tags,
  trainingCards,
} from './schema.ts';
import { ensurePositionCategory } from './categories.ts';
import { dropTaggings, setTags, tagsFor, cleanTagName } from './tags.ts';
import { containsText } from './search.ts';

/**
 * Collections of games, saved positions, position sets, settings and the
 * trash. Deleting moves a row to the trash; it is purged after 30 days.
 */

const now = () => new Date().toISOString();

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
    .all()
    .sort((a, b) => byName.compare(a.name, b.name));
}

/** Names in the order people expect: "Lesson 2" before "Lesson 10", "Écoles" among the E's. */
const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The name, tidied, if no other collection or set (whichever `table` is) out of the trash has it:
 * names are told apart without regard to case or accents, so "Lesson" and "lesson" are one name.
 */
function freeName(db: Db, table: typeof collections | typeof positionSets, what: string, name: string, exceptId?: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new LibraryInputError(`A ${what} needs a name.`);
  const t = table as typeof collections;
  const taken = db
    .select({ name: t.name })
    .from(t)
    .where(and(isNull(t.deletedAt), sql`fold(${t.name}) = fold(${clean})`, exceptId ? ne(t.id, exceptId) : undefined))
    .get();
  if (taken) throw new LibraryInputError(`There is already a ${what} called “${taken.name}”.`);
  return clean;
}

export function createCollection(db: Db, input: { name: string; description?: string | null }): string {
  return db
    .insert(collections)
    .values({ name: freeName(db, collections, 'collection', input.name), description: input.description ?? null })
    .returning({ id: collections.id })
    .get().id;
}

export function updateCollection(db: Db, id: string, input: { name?: string; description?: string | null }): void {
  const name = input.name === undefined ? {} : { name: freeName(db, collections, 'collection', input.name, id) };
  db.update(collections)
    .set({ ...input, ...name, updatedAt: now() })
    .where(eq(collections.id, id))
    .run();
}

/** Adds games at the end of a collection; says how many were not in it already. */
export function addGamesToCollection(db: Db, collectionId: string, gameIds: string[]): number {
  return db.transaction((tx) => {
    let order =
      tx
        .select({ n: sql<number>`coalesce(max(${collectionGames.sortOrder}), 0)` })
        .from(collectionGames)
        .where(eq(collectionGames.collectionId, collectionId))
        .get()?.n ?? 0;
    let added = 0;
    for (const gameId of gameIds) {
      const changes = tx.insert(collectionGames).values({ collectionId, gameId, sortOrder: order + 1 }).onConflictDoNothing().run().changes;
      if (changes) {
        order += 1;
        added += 1;
      }
    }
    return added;
  });
}

/** A game's place in a collection, as removing it hands back so that undoing can put it there again. */
export interface CollectionPlace {
  gameId: string;
  sortOrder: number;
}

export function removeGamesFromCollection(db: Db, collectionId: string, gameIds: string[]): CollectionPlace[] {
  if (!gameIds.length) return [];
  return db
    .delete(collectionGames)
    .where(and(eq(collectionGames.collectionId, collectionId), inArray(collectionGames.gameId, gameIds)))
    .returning({ gameId: collectionGames.gameId, sortOrder: collectionGames.sortOrder })
    .all();
}

/**
 * Puts games back in a collection at the places they had (undoing a removal). The other games keep
 * theirs: removing leaves the numbering with gaps rather than closing them, so each place is free
 * again, unless the collection was reordered since, when the games go after any game on their old
 * number.
 */
export function restoreGamesToCollection(db: Db, collectionId: string, places: CollectionPlace[]): void {
  db.transaction((tx) => {
    for (const place of places) {
      tx.insert(collectionGames).values({ collectionId, gameId: place.gameId, sortOrder: place.sortOrder }).onConflictDoNothing().run();
    }
  });
}

// --- Saved positions ---------------------------------------------------------

/** The name of one of the position categories (db/categories.ts). */
export type Category = string;

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
  /** Only when listing a set: the save's place in the whole set (1 is first), whatever the filter. */
  setPlace?: number;
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

/** A category as stored: matched to an existing one regardless of case, or added to the list. */
function categoryName(db: Db, category: string | null | undefined): string | null | undefined {
  return category ? ensurePositionCategory(db, category) : category === '' ? null : category;
}

function checkSets(db: Db, setIds: string[] | undefined): void {
  if (!setIds?.length) return;
  const known = new Set(db.select({ id: positionSets.id }).from(positionSets).where(inArray(positionSets.id, setIds)).all().map((r) => r.id));
  if (setIds.some((setId) => !known.has(setId))) throw new LibraryInputError('No such position set.');
}

export function createSavedPosition(db: Db, input: SavedPositionInput): SavedPosition {
  checkSets(db, input.setIds);
  const position = findOrCreatePosition(db, input.fen);
  const category = categoryName(db, input.category);
  const turn = input.fen.trim().split(/\s+/)[1] === 'b' ? 'black' : 'white';
  const id = db.transaction((tx) => {
    const row = tx
      .insert(savedPositions)
      .values({
        positionId: position.id,
        fen: input.fen.trim(),
        title: input.title.trim() || 'Untitled position',
        notesMd: input.notesMd ?? null,
        category: category ?? null,
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

/** A request naming something that is not there; the route answers 400 with the message. */
export class LibraryInputError extends Error {
  readonly statusCode = 400;
}

/** Changes a saved position: its fields, tags and sets together, in one transaction. */
export function updateSavedPosition(db: Db, id: string, input: Partial<Omit<SavedPositionInput, 'fen'>>): SavedPosition | undefined {
  const { tags: tagNames, setIds, ...fields } = input;
  checkSets(db, setIds);
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    if ('category' in fields) fields.category = categoryName(t, fields.category);
    // A title is tidied as on create: no spaces around it, and never blank.
    if (typeof fields.title === 'string') fields.title = fields.title.trim() || 'Untitled position';
    t.update(savedPositions).set({ ...fields, updatedAt: now() }).where(eq(savedPositions.id, id)).run();
    if (tagNames) setTags(t, 'saved_position', id, tagNames);
    if (setIds) {
      t.delete(positionSetItems)
        .where(and(eq(positionSetItems.savedPositionId, id), setIds.length ? notInArray(positionSetItems.setId, setIds) : undefined))
        .run();
      addToSets(t, id, setIds);
    }
  });
  return getSavedPosition(db, id);
}

export function getSavedPosition(db: Db, id: string): SavedPosition | undefined {
  const row = db.select(savedColumns).from(savedPositions).where(and(eq(savedPositions.id, id), isNull(savedPositions.deletedAt))).get();
  return row ? withTagsAndSets(db, [row])[0] : undefined;
}

export function listSavedPositions(db: Db, f: SavedPositionFilters = {}): { total: number; positions: SavedPosition[] } {
  const where: SQL[] = [isNull(savedPositions.deletedAt)];
  if (f.q) {
    const q = f.q;
    where.push(
      or(
        containsText(savedPositions.title, q),
        containsText(savedPositions.notesMd, q),
        containsText(savedPositions.keyIdea, q),
        containsText(savedPositions.sourceLabel, q),
        inArray(
          savedPositions.id,
          db
            .select({ id: taggings.targetId })
            .from(taggings)
            .innerJoin(tags, eq(tags.id, taggings.tagId))
            .where(and(eq(taggings.targetType, 'saved_position'), containsText(tags.name, q))),
        ),
      )!,
    );
  }
  if (f.category) where.push(sql`lower(${savedPositions.category}) = lower(${f.category})`);
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
          .where(and(eq(taggings.targetType, 'saved_position'), eq(tags.name, cleanTagName(f.tag)))),
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
  // In a set, each save's place in the whole set (saves in the trash not counted), so a filtered
  // set still numbers its cards as the set itself does.
  const setPlace = f.setId
    ? sql<number | null>`(select count(*) from position_set_items i join saved_positions s on s.id = i.saved_position_id
        where i.set_id = ${f.setId} and s.deleted_at is null
        and i.sort_order <= (select j.sort_order from position_set_items j where j.saved_position_id = saved_positions.id and j.set_id = ${f.setId}))`
    : sql<number | null>`null`;
  const rows = db
    .select({ ...savedColumns, setPlace })
    .from(savedPositions)
    .where(and(...where))
    .orderBy(...order)
    // A set is shown whole (presented, solved, printed): up to 5,000; other lists a page at a time.
    .limit(Math.min(f.limit ?? 60, f.setId ? 5000 : 500))
    .offset(f.offset ?? 0)
    .all()
    .map(({ setPlace: place, ...row }) => (place === null ? row : { ...row, setPlace: place }));
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
    .all()
    .sort((a, b) => byName.compare(a.name, b.name));
}

export function createSet(db: Db, input: { name: string; description?: string | null }): string {
  return db
    .insert(positionSets)
    .values({ name: freeName(db, positionSets, 'set', input.name), description: input.description ?? null })
    .returning({ id: positionSets.id })
    .get().id;
}

export function updateSet(db: Db, id: string, input: { name?: string; description?: string | null }): void {
  const name = input.name === undefined ? {} : { name: freeName(db, positionSets, 'set', input.name, id) };
  db.update(positionSets).set({ ...input, ...name, updatedAt: now() }).where(eq(positionSets.id, id)).run();
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
/**
 * Puts the given saves of a set in the given order. They may be only some of the set (the list was
 * filtered): they then swap among the places they hold, and every other save keeps its place.
 */
export function reorderSet(db: Db, setId: string, savedIds: string[]): void {
  db.transaction((tx) => {
    const full = tx
      .select({ id: positionSetItems.savedPositionId })
      .from(positionSetItems)
      .where(eq(positionSetItems.setId, setId))
      .orderBy(asc(positionSetItems.sortOrder))
      .all()
      .map((r) => r.id);
    const moving = new Set(savedIds.filter((id) => full.includes(id)));
    const queue = savedIds.filter((id) => moving.has(id));
    const order = full.map((id) => (moving.has(id) ? queue.shift()! : id));
    order.forEach((id, i) => {
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

/** Sets the given settings; null, undefined or '' removes one. */
export function updateSettings(db: Db, values: Record<string, unknown>): Settings {
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

/** Takes items out of the trash (one id or several: an undo of a delete puts back what it took). */
export function restore(db: Db, kind: TrashKind, ids: string | string[]): void {
  const table = TRASH_TABLES[kind];
  const list = typeof ids === 'string' ? [ids] : ids;
  if (!list.length) return;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    t.update(table).set({ deletedAt: null }).where(inArray(table.id, list)).run();
    if (kind === 'collection' || kind === 'position_set') keepNamesApart(t, NAMED[kind], list);
  });
}

/** Takes everything out of the trash; says how many items came back. */
export function restoreAll(db: Db): number {
  let restored = 0;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    for (const [kind, table] of Object.entries(TRASH_TABLES)) {
      const ids = t.select({ id: table.id }).from(table).where(isNotNull(table.deletedAt)).all().map((r) => r.id);
      if (!ids.length) continue;
      restored += t.update(table).set({ deletedAt: null }).where(inArray(table.id, ids)).run().changes;
      if (kind === 'collection' || kind === 'position_set') keepNamesApart(t, NAMED[kind], ids);
    }
  });
  return restored;
}

const NAMED = { collection: collections, position_set: positionSets } as const;

/**
 * A collection or set back from the trash whose name was taken in the meantime ("Alpha" deleted, a
 * new "Alpha" made, then the old one restored) is renamed "Alpha (2)", so two never share a name.
 */
function keepNamesApart(db: Db, table: typeof collections | typeof positionSets, ids: string[]): void {
  const t = table as typeof collections;
  for (const row of db.select({ id: t.id, name: t.name }).from(t).where(inArray(t.id, ids)).all()) {
    const taken = (name: string) =>
      db
        .select({ id: t.id })
        .from(t)
        .where(and(isNull(t.deletedAt), ne(t.id, row.id), sql`fold(${t.name}) = fold(${name})`))
        .get();
    if (!taken(row.name)) continue;
    let n = 2;
    while (taken(`${row.name} (${n})`)) n += 1;
    db.update(t).set({ name: `${row.name} (${n})` }).where(eq(t.id, row.id)).run();
  }
}

/** Deletes everything in the trash for good, whatever its age. */
export function emptyTrash(db: Db): number {
  // A cutoff a day ahead takes in everything deleted until now.
  return purgeTrash(db, -1);
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
    const conceptIds = gone(tx.select({ id: concepts.id }).from(concepts).where(lt(concepts.deletedAt, cutoff)).all());
    // A purged repertoire takes its moves with it (cascade); their links and cards must go too.
    const moveIds = gone(
      tx
        .select({ id: repertoireMoves.id })
        .from(repertoireMoves)
        .innerJoin(repertoires, eq(repertoires.id, repertoireMoves.repertoireId))
        .where(lt(repertoires.deletedAt, cutoff))
        .all(),
    );
    dropTaggings(tx as unknown as Db, 'game', gameIds);
    dropTaggings(tx as unknown as Db, 'saved_position', savedIds);
    // Links and training cards point at their target by type and id, with no foreign key to clear them.
    const targets = [
      ['game', gameIds],
      ['saved_position', savedIds],
      ['concept', conceptIds],
      ['repertoire_move', moveIds],
    ] as const;
    for (const [type, ids] of targets) {
      if (!ids.length) continue;
      tx.delete(conceptLinks).where(and(eq(conceptLinks.targetType, type), inArray(conceptLinks.targetId, ids))).run();
      if (type !== 'game') tx.delete(trainingCards).where(and(eq(trainingCards.targetType, type), inArray(trainingCards.targetId, ids))).run();
    }
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
