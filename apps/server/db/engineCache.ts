import type { Analysis, EngineLine } from '@chess/chess-tools';
import { and, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { findOrCreatePosition } from './positions.ts';
import { engineCache } from './schema.ts';

/** A cached analysis good enough for the request: same engine, at least this deep and this many lines. */
export function cachedAnalysis(db: Db, fen: string, engine: string, depth: number, multipv: number): Analysis | undefined {
  const position = findOrCreatePosition(db, fen);
  const row = db
    .select()
    .from(engineCache)
    .where(and(eq(engineCache.positionId, position.id), eq(engineCache.engineVersion, engine)))
    .get();
  if (!row || row.depth < depth || row.multipv < multipv) return undefined;
  const lines = (JSON.parse(row.multipvJson) as EngineLine[]).slice(0, multipv);
  return { fen, engine, depth: row.depth, lines };
}

/** The deepest analysis seen for a position, whatever its depth (for showing at once). */
export function bestCachedAnalysis(db: Db, fen: string, engine: string): Analysis | undefined {
  const position = findOrCreatePosition(db, fen);
  const row = db
    .select()
    .from(engineCache)
    .where(and(eq(engineCache.positionId, position.id), eq(engineCache.engineVersion, engine)))
    .get();
  return row ? { fen, engine, depth: row.depth, lines: JSON.parse(row.multipvJson) as EngineLine[] } : undefined;
}

/** Keeps an analysis unless a deeper one (with as many lines) is already stored. */
export function storeAnalysis(db: Db, analysis: Analysis): void {
  if (!analysis.lines.length || analysis.depth < 8) return;
  const position = findOrCreatePosition(db, analysis.fen);
  const existing = db
    .select({ depth: engineCache.depth, multipv: engineCache.multipv })
    .from(engineCache)
    .where(and(eq(engineCache.positionId, position.id), eq(engineCache.engineVersion, analysis.engine)))
    .get();
  if (existing && existing.depth >= analysis.depth && existing.multipv >= analysis.lines.length) return;
  const values = {
    positionId: position.id,
    engineVersion: analysis.engine,
    depth: analysis.depth,
    multipv: analysis.lines.length,
    multipvJson: JSON.stringify(analysis.lines),
    createdAt: new Date().toISOString(),
  };
  db.insert(engineCache)
    .values(values)
    .onConflictDoUpdate({ target: [engineCache.positionId, engineCache.engineVersion], set: values })
    .run();
}
