import { randomUUID } from 'node:crypto';
import {
  type Color,
  type NewEdge,
  type Priority,
  type RepEdge,
  START_FEN,
  createGame,
  isWhiteMove,
  playMove,
  positionKey,
  movesCutBy,
} from '@chess/chess-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './client.ts';
import { findOrCreatePosition } from './positions.ts';
import { positions, repertoireMoves, repertoires } from './schema.ts';

export interface RepertoireSummary {
  id: string;
  name: string;
  color: Color;
  moves: number;
}

const now = () => new Date().toISOString();

export function listRepertoires(db: Db): RepertoireSummary[] {
  return db
    .select({
      id: repertoires.id,
      name: repertoires.name,
      color: repertoires.color,
      moves: sql<number>`(select count(*) from repertoire_moves m where m.repertoire_id = repertoires.id)`,
    })
    .from(repertoires)
    .where(isNull(repertoires.deletedAt))
    .orderBy(repertoires.color, repertoires.name)
    .all();
}

export function getRepertoire(db: Db, id: string): RepertoireSummary | undefined {
  return listRepertoires(db).find((r) => r.id === id);
}

export function createRepertoire(db: Db, input: { name: string; color: Color }): string {
  return db
    .insert(repertoires)
    .values({ name: input.name.trim() || (input.color === 'white' ? 'White' : 'Black'), color: input.color })
    .returning({ id: repertoires.id })
    .get().id;
}

export function renameRepertoire(db: Db, id: string, name: string): void {
  db.update(repertoires).set({ name: name.trim(), updatedAt: now() }).where(eq(repertoires.id, id)).run();
}

const fromPos = alias(positions, 'from_pos');
const toPos = alias(positions, 'to_pos');

/** Every move of a repertoire, with the keys of the positions it joins. */
export function getEdges(db: Db, repertoireId: string): RepEdge[] {
  return db
    .select({
      id: repertoireMoves.id,
      fromKey: fromPos.fenKey,
      toKey: toPos.fenKey,
      san: repertoireMoves.san,
      uci: repertoireMoves.uci,
      isMyMove: repertoireMoves.isMyMove,
      isMain: repertoireMoves.isMain,
      priority: repertoireMoves.priority,
      comment: repertoireMoves.commentMd,
      nags: repertoireMoves.nags,
    })
    .from(repertoireMoves)
    .innerJoin(fromPos, eq(fromPos.id, repertoireMoves.fromPositionId))
    .innerJoin(toPos, eq(toPos.id, repertoireMoves.toPositionId))
    .where(eq(repertoireMoves.repertoireId, repertoireId))
    .orderBy(repertoireMoves.createdAt, sql`repertoire_moves.rowid`)
    .all()
    .map((row) => ({ ...row, nags: JSON.parse(row.nags) as number[] }));
}

/**
 * Adds moves to a repertoire. A move already there is kept (its comment is
 * filled in if it had none). The first move from a position is its main line.
 */
export function addEdges(db: Db, repertoireId: string, edges: NewEdge[]): { added: number; existing: number } {
  let added = 0;
  let existing = 0;
  db.transaction((tx) => {
    const t = tx as unknown as Db;
    for (const e of edges) {
      const from = findOrCreatePosition(t, e.fromFen);
      const to = findOrCreatePosition(t, e.toFen);
      const already = t
        .select({ id: repertoireMoves.id, comment: repertoireMoves.commentMd })
        .from(repertoireMoves)
        .where(and(eq(repertoireMoves.repertoireId, repertoireId), eq(repertoireMoves.fromPositionId, from.id), eq(repertoireMoves.uci, e.uci)))
        .get();
      if (already) {
        existing += 1;
        if (!already.comment && e.comment) {
          t.update(repertoireMoves).set({ commentMd: e.comment, updatedAt: now() }).where(eq(repertoireMoves.id, already.id)).run();
        }
        continue;
      }
      const hasMain = t
        .select({ id: repertoireMoves.id })
        .from(repertoireMoves)
        .where(and(eq(repertoireMoves.repertoireId, repertoireId), eq(repertoireMoves.fromPositionId, from.id)))
        .get();
      t.insert(repertoireMoves)
        .values({
          id: randomUUID(),
          repertoireId,
          fromPositionId: from.id,
          toPositionId: to.id,
          san: e.san,
          uci: e.uci,
          isMyMove: e.isMyMove,
          isMain: !hasMain,
          commentMd: e.comment,
          priority: e.priority ?? 'must',
          nags: JSON.stringify(e.nags),
        })
        .run();
      added += 1;
    }
  });
  return { added, existing };
}

/** A line that cannot go into the repertoire; the route answers 400 with the message. */
export class RepertoireError extends Error {
  readonly statusCode = 400;
}

/**
 * The positions a new line may start from: the starting position and every position the
 * repertoire's moves already reach. A line from anywhere else could never be shown or trained.
 */
export function reachedPositions(db: Db, repertoireId: string): Set<string> {
  return new Set([positionKey(START_FEN), ...getEdges(db, repertoireId).map((e) => e.toKey)]);
}

export const NOT_CONNECTED =
  'starts from a set-up position this repertoire does not reach yet. A repertoire grows from the starting position: add the moves that lead to this position first.';

/** Adds a line of moves from a position: what R does on the analysis board. */
export function addLine(db: Db, repertoireId: string, startFen: string, sans: string[]): { added: number; existing: number } {
  const repertoire = getRepertoire(db, repertoireId);
  if (!repertoire) throw new Error('No such repertoire.');
  if (sans.length && !reachedPositions(db, repertoireId).has(positionKey(startFen || START_FEN))) {
    throw new RepertoireError(`This line ${NOT_CONNECTED}`);
  }
  const root = createGame(startFen || START_FEN).root;
  let node = root;
  const edges: NewEdge[] = [];
  for (const san of sans) {
    const next = playMove(node, san);
    edges.push({
      fromFen: node.fen,
      toFen: next.fen,
      san: next.san,
      uci: next.uci,
      isMyMove: isWhiteMove(next) === (repertoire.color === 'white'),
      isMain: true,
      comment: null,
      nags: [],
    });
    node = next;
  }
  return addEdges(db, repertoireId, edges);
}

export function updateMove(
  db: Db,
  id: string,
  changes: { isMain?: boolean; priority?: Priority; comment?: string | null; nags?: number[] },
): void {
  const move = db.select().from(repertoireMoves).where(eq(repertoireMoves.id, id)).get();
  if (!move) return;
  db.transaction((tx) => {
    if (changes.isMain) {
      // One main line per position.
      tx.update(repertoireMoves)
        .set({ isMain: false })
        .where(and(eq(repertoireMoves.repertoireId, move.repertoireId), eq(repertoireMoves.fromPositionId, move.fromPositionId)))
        .run();
    }
    tx.update(repertoireMoves)
      .set({
        ...(changes.isMain !== undefined ? { isMain: changes.isMain } : {}),
        ...(changes.priority ? { priority: changes.priority } : {}),
        ...(changes.comment !== undefined ? { commentMd: changes.comment?.trim() || null } : {}),
        ...(changes.nags ? { nags: JSON.stringify(changes.nags) } : {}),
        updatedAt: now(),
      })
      .where(eq(repertoireMoves.id, id))
      .run();
  });
}

/**
 * Deletes a move and the moves only it led to. Moves that were out of reach already (lines added
 * from a set-up position before that was refused) are left alone: this delete did not cut them off.
 */
export function deleteMove(db: Db, id: string): number {
  const move = db.select().from(repertoireMoves).where(eq(repertoireMoves.id, id)).get();
  if (!move) return 0;
  const ids = movesCutBy(getEdges(db, move.repertoireId), id);
  db.transaction((tx) => {
    tx.delete(repertoireMoves).where(inArray(repertoireMoves.id, ids)).run();
    // If the deleted move was the main line, the next move from that position takes over.
    const next = tx
      .select({ id: repertoireMoves.id })
      .from(repertoireMoves)
      .where(and(eq(repertoireMoves.repertoireId, move.repertoireId), eq(repertoireMoves.fromPositionId, move.fromPositionId)))
      .get();
    if (move.isMain && next) tx.update(repertoireMoves).set({ isMain: true }).where(eq(repertoireMoves.id, next.id)).run();
  });
  return ids.length;
}

/** What each repertoire has at a position: its moves from there, and whether it reaches it at all. */
export function repertoiresAt(db: Db, fen: string): { repertoire: RepertoireSummary; moves: RepEdge[]; reached: boolean }[] {
  const key = positionKey(fen);
  return listRepertoires(db)
    .map((repertoire) => {
      const edges = getEdges(db, repertoire.id);
      return {
        repertoire,
        moves: edges.filter((e) => e.fromKey === key).sort((a, b) => Number(b.isMain) - Number(a.isMain)),
        reached: key === positionKey(START_FEN) ? edges.length > 0 : edges.some((e) => e.toKey === key),
      };
    })
    .filter((r) => r.reached || r.moves.length > 0);
}

/**
 * Whether a repertoire reaches a position through one of my own moves: a move played in training
 * that lands there transposes into the repertoire rather than leaving it.
 */
export function reachesByMyMove(db: Db, repertoireId: string, fen: string): boolean {
  const key = positionKey(fen);
  return getEdges(db, repertoireId).some((e) => e.isMyMove && e.toKey === key);
}
