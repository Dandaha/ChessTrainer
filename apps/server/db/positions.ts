import { positionKey } from '@chess/chess-core';
import { count, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { positions } from './schema.ts';

export interface PositionRow {
  id: string;
  fenKey: string;
  fullFen: string;
}

/** The stored position for a FEN, created on first sight. Transpositions share one row. */
export function findOrCreatePosition(db: Db, fen: string): PositionRow {
  const fenKey = positionKey(fen);
  const existing = db.select().from(positions).where(eq(positions.fenKey, fenKey)).get();
  if (existing) return existing;
  return db
    .insert(positions)
    .values({ fenKey, fullFen: fen })
    .onConflictDoNothing()
    .returning()
    .get() ?? db.select().from(positions).where(eq(positions.fenKey, fenKey)).get()!;
}

export function findPosition(db: Db, fen: string): PositionRow | undefined {
  return db.select().from(positions).where(eq(positions.fenKey, positionKey(fen))).get();
}

export function countPositions(db: Db): number {
  return db.select({ n: count() }).from(positions).get()?.n ?? 0;
}
