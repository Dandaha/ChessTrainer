import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { TAG_TARGETS, taggings, tags } from './schema.ts';

export type TagTarget = (typeof TAG_TARGETS)[number];

/** Tag names as people type them: trimmed, lower case, no duplicates, no empties. */
export function cleanTagNames(names: string[]): string[] {
  return [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
}

/** Replaces the tags on one item. */
export function setTags(db: Db, targetType: TagTarget, targetId: string, names: string[]): void {
  db.delete(taggings)
    .where(and(eq(taggings.targetType, targetType), eq(taggings.targetId, targetId)))
    .run();
  for (const name of cleanTagNames(names)) {
    db.insert(tags).values({ name }).onConflictDoNothing().run();
    const tag = db.select().from(tags).where(eq(tags.name, name)).get()!;
    db.insert(taggings).values({ tagId: tag.id, targetType, targetId }).onConflictDoNothing().run();
  }
}

/** The tags of many items at once, by item id. */
export function tagsFor(db: Db, targetType: TagTarget, ids: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = db
    .select({ targetId: taggings.targetId, name: tags.name })
    .from(taggings)
    .innerJoin(tags, eq(tags.id, taggings.tagId))
    .where(and(eq(taggings.targetType, targetType), inArray(taggings.targetId, ids)))
    .orderBy(tags.name)
    .all();
  for (const row of rows) {
    const list = out.get(row.targetId) ?? [];
    list.push(row.name);
    out.set(row.targetId, list);
  }
  return out;
}

/** Every tag with how often it is used, most used first. */
export function allTags(db: Db, targetType?: TagTarget): { name: string; count: number }[] {
  const query = db
    .select({ name: tags.name, count: sql<number>`count(${taggings.targetId})` })
    .from(tags)
    .innerJoin(taggings, eq(taggings.tagId, tags.id));
  const filtered = targetType ? query.where(eq(taggings.targetType, targetType)) : query;
  return filtered.groupBy(tags.name).orderBy(sql`count(${taggings.targetId}) desc`, tags.name).all();
}

/** Removes every tag from items that are gone for good. */
export function dropTaggings(db: Db, targetType: TagTarget, ids: string[]): void {
  if (!ids.length) return;
  db.delete(taggings)
    .where(and(eq(taggings.targetType, targetType), inArray(taggings.targetId, ids)))
    .run();
}
