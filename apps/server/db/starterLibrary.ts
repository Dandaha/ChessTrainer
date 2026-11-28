import { isNull } from 'drizzle-orm';
import type { Db } from './client.ts';
import { createConcept, linkConcept } from './concepts.ts';
import { getSettings, updateSettings } from './library.ts';
import { concepts } from './schema.ts';
import { STARTER_CONCEPTS } from './starterConcepts.ts';
// Names compared as search compares them: no case, no accents, one kind of apostrophe.
import { fold } from './search.ts';

/**
 * Puts the starter concepts (db/starterConcepts.ts) into a library: once, the first time the app
 * starts with them (a new install, or the update that brought them), and again on request for any
 * that are missing. A concept the library already has — by title or by another name, ignoring case
 * and accents — is left alone, so nothing is ever duplicated or overwritten.
 */

/** Raised when the starter library grows, so libraries that have the earlier set get the new ones. */
const VERSION = 1;
const SETTING = 'starterConcepts';

/** Every name the library's concepts go by (titles and other names), folded, with the concept's id. */
function knownNames(db: Db): Map<string, string> {
  const known = new Map<string, string>();
  for (const row of db.select({ id: concepts.id, title: concepts.title, aliases: concepts.aliases }).from(concepts).where(isNull(concepts.deletedAt)).all()) {
    for (const name of [row.title, ...(JSON.parse(row.aliases) as string[])]) known.set(fold(name.trim()), row.id);
  }
  return known;
}

/** How many starter concepts the library does not have (by title or another name). */
export function missingStarterConcepts(db: Db): number {
  const known = knownNames(db);
  return STARTER_CONCEPTS.filter((concept) => ![concept.title, ...(concept.aliases ?? [])].some((name) => known.has(fold(name)))).length;
}

/** Adds the starter concepts the library does not have; says how many were added. */
export function addStarterConcepts(db: Db): number {
  return db.transaction((tx) => {
    const t = tx as unknown as Db;
    const known = knownNames(t);
    const ids = new Map<string, string>();
    const fresh = new Set<string>();
    for (const concept of STARTER_CONCEPTS) {
      const found = [concept.title, ...(concept.aliases ?? [])].map((name) => known.get(fold(name))).find(Boolean);
      if (found) {
        ids.set(concept.title, found);
        continue;
      }
      const created = createConcept(t, {
        title: concept.title,
        aliases: concept.aliases ?? [],
        category: concept.category,
        bodyMd: concept.body,
        keySigns: concept.signs,
        level: concept.level,
      });
      ids.set(concept.title, created.id);
      fresh.add(created.id);
      known.set(fold(concept.title), created.id);
    }
    // Related concepts, linked where at least one of the two is new: links the person removed between
    // concepts they already had stay removed.
    for (const concept of STARTER_CONCEPTS) {
      const from = ids.get(concept.title);
      for (const title of concept.related ?? []) {
        const to = ids.get(title);
        if (from && to && from !== to && (fresh.has(from) || fresh.has(to))) linkConcept(t, from, 'concept', { id: to });
      }
    }
    return fresh.size;
  });
}

/** At start-up: adds the starter concepts once per library (and once more per new version of the set). */
export function addStarterConceptsOnce(db: Db): number {
  const done = getSettings(db)[SETTING];
  if (typeof done === 'number' && done >= VERSION) return 0;
  const added = addStarterConcepts(db);
  updateSettings(db, { [SETTING]: VERSION });
  return added;
}
