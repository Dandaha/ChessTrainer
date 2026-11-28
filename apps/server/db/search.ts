import { type SQL, and, or, sql } from 'drizzle-orm';
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
  const pattern = `%${fold(typed.trim()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`fold(${column}) like ${pattern} escape '\\'`;
}

/**
 * Every word typed, each found in one of the columns, in any order: "Magnus Carlsen" finds
 * "Carlsen, Magnus", "najdorf sicilian" finds "Sicilian Defense: Najdorf". Undefined when nothing was
 * typed but spaces.
 */
export function containsWords(columns: (SQLiteColumn | SQL)[], typed: string): SQL | undefined {
  const words = typed.split(/[\s,]+/).filter(Boolean);
  if (!words.length) return undefined;
  return and(...words.map((word) => or(...columns.map((column) => containsText(column, word)))));
}

/**
 * The folding search uses, in JavaScript and (as fold()) in SQL: case and accents are ignored, so
 * "muller" finds "Müller" and "reti" finds "Réti".
 */
export function fold(text: string): string {
  // Curly apostrophes too: "Anastasia's" finds "Anastasia’s".
  // Letters that are not a base letter plus a mark fold by hand: "cagri" finds "Çağrı", "lodz" "Łódź".
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘ʼ`]/g, "'")
    .toLowerCase()
    .replace(/[ıłøđßæœ]/g, (c) => FOLDED[c]!);
}

const FOLDED: Record<string, string> = { ı: 'i', ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe' };
