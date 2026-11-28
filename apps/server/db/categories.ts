import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { conceptCategories, concepts, positionCategories, savedPositions } from './schema.ts';

/**
 * The person's own categories: one list for saved positions, one for concepts. An item holds its
 * category by name, so renaming a category renames it on every item, and removing one leaves its
 * items without a category. Names are unique regardless of case: "Endgame" and "endgame" are one.
 */

export type CategoryKind = 'position' | 'concept';

export interface Category {
  id: string;
  name: string;
  /** Items in it, not counting the trash. */
  count: number;
}

export type PositionCategory = Category;

/** A name that cannot be used; the route answers 400 with the message. */
export class CategoryError extends Error {
  readonly statusCode = 400;
}

const MAX_LENGTH = 40;

/**
 * Each kind's tables. The two category tables, and the two item tables' category and trash columns,
 * are alike, so one set of functions serves both (typed as the position tables).
 */
const KINDS = {
  position: { categories: positionCategories, items: savedPositions, categoriesName: 'position_categories', itemsName: 'saved_positions' },
  concept: { categories: conceptCategories, items: concepts, categoriesName: 'concept_categories', itemsName: 'concepts' },
} as const;

function tables(kind: CategoryKind) {
  const k = KINDS[kind];
  return {
    categories: k.categories as typeof positionCategories,
    items: k.items as unknown as typeof savedPositions,
    categoriesName: k.categoriesName,
    itemsName: k.itemsName,
  };
}

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new CategoryError('A category needs a name.');
  if (clean.length > MAX_LENGTH) throw new CategoryError(`The name is too long: at most ${MAX_LENGTH} characters.`);
  return clean;
}

function byName(db: Db, kind: CategoryKind, name: string) {
  const { categories } = tables(kind);
  return db
    .select()
    .from(categories)
    .where(sql`lower(${categories.name}) = lower(${name})`)
    .get();
}

export function listCategories(db: Db, kind: CategoryKind): Category[] {
  const { categories, categoriesName, itemsName } = tables(kind);
  // Raw table names: drizzle leaves the outer table unqualified inside a subquery.
  const items = sql.raw(itemsName);
  const outer = sql.raw(categoriesName);
  return db
    .select({
      id: categories.id,
      name: categories.name,
      count: sql<number>`(select count(*) from ${items} where ${items}.category = ${outer}.name and ${items}.deleted_at is null)`,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
}

export function createCategory(db: Db, kind: CategoryKind, name: string): Category {
  const { categories } = tables(kind);
  const clean = cleanName(name);
  const existing = byName(db, kind, clean);
  if (existing) throw new CategoryError(`There is already a category called “${existing.name}”.`);
  const last = db.select({ max: sql<number | null>`max(${categories.sortOrder})` }).from(categories).get();
  const row = db
    .insert(categories)
    .values({ name: clean, sortOrder: (last?.max ?? 0) + 1 })
    .returning()
    .get();
  return { id: row.id, name: row.name, count: 0 };
}

/**
 * The category's name as stored, adding the category if it is new: used when an item names a
 * category, so the list always holds every category in use.
 */
export function ensureCategory(db: Db, kind: CategoryKind, name: string): string {
  const clean = cleanName(name);
  return byName(db, kind, clean)?.name ?? createCategory(db, kind, clean).name;
}

export function renameCategory(db: Db, kind: CategoryKind, id: string, name: string): Category | undefined {
  const { categories, items } = tables(kind);
  const clean = cleanName(name);
  return db.transaction((tx) => {
    const category = tx.select().from(categories).where(eq(categories.id, id)).get();
    if (!category) return undefined;
    const taken = byName(tx as unknown as Db, kind, clean);
    if (taken && taken.id !== id) throw new CategoryError(`There is already a category called “${taken.name}”.`);
    tx.update(items).set({ category: clean }).where(eq(items.category, category.name)).run();
    tx.update(categories).set({ name: clean }).where(eq(categories.id, id)).run();
    return listCategories(tx as unknown as Db, kind).find((c) => c.id === id);
  });
}

/** Removes a category; its items stay, without a category. Returns how many there were. */
export function deleteCategory(db: Db, kind: CategoryKind, id: string): { removed: boolean; uncategorized: number } {
  const { categories, items } = tables(kind);
  return db.transaction((tx) => {
    const category = tx.select().from(categories).where(eq(categories.id, id)).get();
    if (!category) return { removed: false, uncategorized: 0 };
    const cleared = tx
      .update(items)
      .set({ category: null })
      .where(eq(items.category, category.name))
      .returning({ id: items.id, deletedAt: items.deletedAt })
      .all();
    tx.delete(categories).where(eq(categories.id, id)).run();
    return { removed: true, uncategorized: cleared.filter((row) => !row.deletedAt).length };
  });
}

// Saved positions' categories, by their names from before there were two kinds.
export const listPositionCategories = (db: Db) => listCategories(db, 'position');
export const createPositionCategory = (db: Db, name: string) => createCategory(db, 'position', name);
export const ensurePositionCategory = (db: Db, name: string) => ensureCategory(db, 'position', name);
export const renamePositionCategory = (db: Db, id: string, name: string) => renameCategory(db, 'position', id, name);
export const deletePositionCategory = (db: Db, id: string) => deleteCategory(db, 'position', id);
