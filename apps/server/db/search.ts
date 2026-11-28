import { type SQL, sql } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Text search, "contains", for every search box: case and accents are ignored in every alphabet (SQLite's own
 * LIKE folds only A–Z, so "каспаров" missed "Каспаров"), and what was typed is matched literally,
 * "_" and "%" included (Lichess names like tyler_920).
 *
 * Both sides go through fold(), registered on each connection by openDatabase. On Postgres this
 * would be lower() with ILIKE.
 */
export function containsText(column: SQLiteColumn | SQL, typed: string): SQL {
  const pattern = `%${fold(typed).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`fold(${column}) like ${pattern} escape '\\'`;
}

/**
 * The folding search uses, in JavaScript and (as fold()) in SQL: case and accents are ignored, so
 * "muller" finds "Müller" and "reti" finds "Réti".
 */
export function fold(text: string): string {
  // Curly apostrophes too: "Anastasia's" finds "Anastasia’s".
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘ʼ`]/g, "'").toLowerCase();
}
