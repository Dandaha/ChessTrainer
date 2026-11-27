import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { positionCategories, savedPositions } from './schema.ts';

/**
 * The categories saved positions are filed under. A save holds its category by name, so renaming a
 * category renames it on every save, and removing one leaves its saves without a category.
 * Names are unique regardless of case: "Endgame" and "endgame" are the same category.
 */

export interface PositionCategory {
  id: string;
  name: string;
  /** Saved positions in it, not counting the trash. */
  count: number;
}

/** A name that cannot be used; the route answers 400 with the message. */
export class CategoryError extends Error {
  readonly statusCode = 400;
}

const MAX_LENGTH = 40;

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new CategoryError('A category needs a name.');
  if (clean.length > MAX_LENGTH) throw new CategoryError(`Keep the name under ${MAX_LENGTH} characters.`);
  return clean;
}

function byName(db: Db, name: string) {
  return db
    .select()
    .from(positionCategories)
    .where(sql`lower(${positionCategories.name}) = lower(${name})`)
    .get();
}

export function listPositionCategories(db: Db): PositionCategory[] {
  return db
    .select({
      id: positionCategories.id,
      name: positionCategories.name,
      // Raw column names: drizzle leaves the outer table unqualified inside a subquery.
      count: sql<number>`(select count(*) from saved_positions where saved_positions.category = position_categories.name and saved_positions.deleted_at is null)`,
    })
    .from(positionCategories)
    .orderBy(asc(positionCategories.sortOrder), asc(positionCategories.name))
    .all();
}

export function createPositionCategory(db: Db, name: string): PositionCategory {
  const clean = cleanName(name);
  const existing = byName(db, clean);
  if (existing) throw new CategoryError(`There is already a category called “${existing.name}”.`);
  const last = db.select({ max: sql<number | null>`max(${positionCategories.sortOrder})` }).from(positionCategories).get();
  const row = db
    .insert(positionCategories)
    .values({ name: clean, sortOrder: (last?.max ?? 0) + 1 })
    .returning()
    .get();
  return { id: row.id, name: row.name, count: 0 };
}

/**
 * The category's name as stored, adding the category if it is new: used when a save names a category,
 * so the list always holds every category in use.
 */
export function ensurePositionCategory(db: Db, name: string): string {
  const clean = cleanName(name);
  return byName(db, clean)?.name ?? createPositionCategory(db, clean).name;
}

export function renamePositionCategory(db: Db, id: string, name: string): PositionCategory | undefined {
  const clean = cleanName(name);
  return db.transaction((tx) => {
    const category = tx.select().from(positionCategories).where(eq(positionCategories.id, id)).get();
    if (!category) return undefined;
    const taken = byName(tx as unknown as Db, clean);
    if (taken && taken.id !== id) throw new CategoryError(`There is already a category called “${taken.name}”.`);
    tx.update(savedPositions).set({ category: clean }).where(eq(savedPositions.category, category.name)).run();
    tx.update(positionCategories).set({ name: clean }).where(eq(positionCategories.id, id)).run();
    return listPositionCategories(tx as unknown as Db).find((c) => c.id === id);
  });
}

/** Removes a category; its saved positions stay, without a category. Returns how many there were. */
export function deletePositionCategory(db: Db, id: string): { removed: boolean; uncategorized: number } {
  return db.transaction((tx) => {
    const category = tx.select().from(positionCategories).where(eq(positionCategories.id, id)).get();
    if (!category) return { removed: false, uncategorized: 0 };
    const cleared = tx
      .update(savedPositions)
      .set({ category: null })
      .where(eq(savedPositions.category, category.name))
      .returning({ id: savedPositions.id, deletedAt: savedPositions.deletedAt })
      .all();
    tx.delete(positionCategories).where(eq(positionCategories.id, id)).run();
    return { removed: true, uncategorized: cleared.filter((row) => !row.deletedAt).length };
  });
}
