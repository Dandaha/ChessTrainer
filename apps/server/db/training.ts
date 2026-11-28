import { randomUUID } from 'node:crypto';
import { type Color, type RepEdge, START_FEN, createGame, playMove, positionKey, repertoireTree } from '@chess/chess-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Card, type Grade, Rating, State, createEmptyCard, fsrs } from 'ts-fsrs';
import type { Db } from './client.ts';
import { type SavedPosition, getSavedPosition } from './library.ts';
import { getEdges, listRepertoires } from './repertoire.ts';
import { repertoireMoves, repertoires, savedPositions, trainingCards, trainingReviews } from './schema.ts';

/**
 * Spaced repetition with FSRS. A card is one thing to remember: a main-line
 * move of mine in a repertoire ("what do I play here?") or a saved position
 * put in training. Cards appear on their own as repertoires grow; new ones
 * are introduced a few a day.
 */

const scheduler = fsrs({ enable_fuzz: true });
/**
 * "Nice to know" lines are scheduled for 80% recall instead of 90%: their reviews come further apart,
 * so the moves that must be known get most of the time.
 */
const niceScheduler = fsrs({ enable_fuzz: true, request_retention: 0.8 });

export type CardRow = typeof trainingCards.$inferSelect;

function toFsrs(row: CardRow): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    scheduled_days: row.scheduledDays,
    learning_steps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    ...(row.lastReview ? { last_review: new Date(row.lastReview) } : {}),
  };
}

function fromFsrs(card: Card) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    lastReview: card.last_review ? card.last_review.toISOString() : null,
  };
}

/** Creates the cards that are missing: one per main-line move of mine, one per saved position in training. */
export function syncCards(db: Db, now = new Date()): void {
  const wanted: { targetType: 'repertoire_move' | 'saved_position'; targetId: string }[] = [
    ...db
      .select({ id: repertoireMoves.id })
      .from(repertoireMoves)
      .innerJoin(repertoires, eq(repertoires.id, repertoireMoves.repertoireId))
      .where(and(eq(repertoireMoves.isMyMove, true), eq(repertoireMoves.isMain, true), isNull(repertoires.deletedAt)))
      .all()
      .map((r) => ({ targetType: 'repertoire_move' as const, targetId: r.id })),
    ...db
      .select({ id: savedPositions.id })
      .from(savedPositions)
      .where(and(eq(savedPositions.inTraining, true), isNull(savedPositions.deletedAt)))
      .all()
      .map((r) => ({ targetType: 'saved_position' as const, targetId: r.id })),
  ];
  // Most calls find every card there already: insert only the missing ones.
  const have = new Set(
    db
      .select({ targetType: trainingCards.targetType, targetId: trainingCards.targetId })
      .from(trainingCards)
      .all()
      .map((c) => `${c.targetType}|${c.targetId}`),
  );
  const missing = wanted.filter((w) => !have.has(`${w.targetType}|${w.targetId}`));
  if (!missing.length) return;
  const empty = fromFsrs(createEmptyCard(now));
  db.transaction((tx) => {
    for (const w of missing) {
      tx.insert(trainingCards).values({ id: randomUUID(), ...w, ...empty }).onConflictDoNothing().run();
    }
  });
}

/** Cards whose target still counts: the move is still a main move of mine, the save is still in training. */
function activeCards(db: Db, filter: { repertoireId?: string; type?: 'repertoire_move' | 'saved_position' } = {}): CardRow[] {
  const rep = db
    .select({ card: trainingCards })
    .from(trainingCards)
    .innerJoin(repertoireMoves, eq(repertoireMoves.id, trainingCards.targetId))
    .innerJoin(repertoires, eq(repertoires.id, repertoireMoves.repertoireId))
    .where(
      and(
        eq(trainingCards.targetType, 'repertoire_move'),
        eq(repertoireMoves.isMyMove, true),
        eq(repertoireMoves.isMain, true),
        isNull(repertoires.deletedAt),
        filter.repertoireId ? eq(repertoires.id, filter.repertoireId) : undefined,
      ),
    )
    .all()
    .map((r) => r.card);
  const saved =
    filter.repertoireId || filter.type === 'repertoire_move'
      ? []
      : db
          .select({ card: trainingCards })
          .from(trainingCards)
          .innerJoin(savedPositions, eq(savedPositions.id, trainingCards.targetId))
          .where(and(eq(trainingCards.targetType, 'saved_position'), eq(savedPositions.inTraining, true), isNull(savedPositions.deletedAt)))
          .all()
          .map((r) => r.card);
  return filter.type === 'saved_position' ? saved : [...rep, ...saved];
}

function endOfDay(now: Date): string {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function startOfDay(now: Date): string {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * How many cards were seen for the first time today: cards whose first review falls today, however
 * often they were reviewed since (counting cards reviewed exactly once let a re-asked card free a slot).
 */
function newSeenToday(db: Db, now: Date): number {
  return (
    db.get<{ n: number }>(
      sql`select count(*) as n from (select min(reviewed_at) as first from training_reviews group by card_id) where first >= ${startOfDay(now)}`,
    )?.n ?? 0
  );
}

/** A local calendar day, "2026-11-28": the day the person lives in, not the UTC one. */
function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface RepertoireCardDetail {
  card: CardRow;
  kind: 'repertoire_move';
  repertoire: { id: string; name: string; color: Color };
  /** The moves from the start to the position where I must find my move. */
  line: string[];
  startFen: string;
  fen: string;
  /** My main move here, and my other prepared moves (accepted as well, but not the main one). */
  answer: { san: string; uci: string; comment: string | null };
  /** "Nice to know" rather than must-know (the move, or a move on the line to it, is marked so). */
  nice: boolean;
  alternatives: { san: string; uci: string }[];
}

export interface PositionCardDetail {
  card: CardRow;
  kind: 'saved_position';
  saved: SavedPosition;
}

export type CardDetail = RepertoireCardDetail | PositionCardDetail;

/** For each repertoire, the moves leading to every position it reaches (shortest order first). */
function linesTo(edges: RepEdge[]): { lines: Map<string, string[]>; nice: Map<string, boolean> } {
  const start = positionKey(START_FEN);
  const paths = new Map<string, string[]>([[start, []]]);
  // Whether the line to a position passes a move marked "nice to know": then all of it is.
  const nice = new Map<string, boolean>([[start, false]]);
  const walk = (nodes: ReturnType<typeof repertoireTree>, trail: string[], niceSoFar: boolean) => {
    for (const n of nodes) {
      const path = [...trail, n.edge.san];
      const isNice = niceSoFar || n.edge.priority === 'nice';
      if (!paths.has(n.edge.toKey)) {
        paths.set(n.edge.toKey, path);
        nice.set(n.edge.toKey, isNice);
      }
      if (!n.transposition) walk(n.children, path, isNice);
    }
  };
  walk(repertoireTree(edges), [], false);
  return { lines: paths, nice };
}

/**
 * Builds the details of cards one at a time, as a session shows them: a repertoire's moves and lines
 * are loaded once, when its first card is asked for, and a card's position is played out only when
 * the card is wanted (a large repertoire has thousands of new cards, and a day shows twenty).
 */
function detailer(db: Db) {
  const moveRepertoire = new Map(
    db
      .select({ id: repertoireMoves.id, repertoireId: repertoireMoves.repertoireId })
      .from(repertoireMoves)
      .where(and(eq(repertoireMoves.isMyMove, true), eq(repertoireMoves.isMain, true)))
      .all()
      .map((m) => [m.id, m.repertoireId]),
  );
  const repertoireList = listRepertoires(db);
  type Context = {
    info: { id: string; name: string; color: Color };
    byId: Map<string, RepEdge>;
    byFrom: Map<string, RepEdge[]>;
    lines: Map<string, string[]>;
    nice: Map<string, boolean>;
  };
  const contexts = new Map<string, Context | null>();
  const contextOf = (card: CardRow): Context | null => {
    const id = moveRepertoire.get(card.targetId);
    if (!id) return null;
    if (!contexts.has(id)) {
      const info = repertoireList.find((r) => r.id === id);
      const edges = info ? getEdges(db, id) : [];
      const byFrom = new Map<string, RepEdge[]>();
      for (const e of edges) byFrom.set(e.fromKey, [...(byFrom.get(e.fromKey) ?? []), e]);
      contexts.set(
        id,
        info ? { info: { id, name: info.name, color: info.color }, byId: new Map(edges.map((e) => [e.id, e])), byFrom, ...linesTo(edges) } : null,
      );
    }
    return contexts.get(id)!;
  };

  return {
    repertoireOf: (card: CardRow) => moveRepertoire.get(card.targetId),

    /** Whether a repertoire card is "nice to know": its move, or a move on the line to it, is marked so. */
    nice(card: CardRow): boolean {
      const ctx = contextOf(card);
      const edge = ctx?.byId.get(card.targetId);
      return !!edge && (edge.priority === 'nice' || ctx!.nice.get(edge.fromKey) === true);
    },

    /** How many moves from the start a repertoire card's position is; undefined when it can't be reached. */
    depth(card: CardRow): number | undefined {
      const ctx = contextOf(card);
      const edge = ctx?.byId.get(card.targetId);
      return edge ? ctx!.lines.get(edge.fromKey)?.length : undefined;
    },

    /** The card as a session shows it, or null when there is nothing to drill. */
    make(card: CardRow): CardDetail | null {
      if (card.targetType === 'saved_position') {
        const saved = getSavedPosition(db, card.targetId);
        return saved ? { card, kind: 'saved_position', saved } : null;
      }
      const ctx = contextOf(card);
      const edge = ctx?.byId.get(card.targetId);
      const line = edge ? ctx!.lines.get(edge.fromKey) : undefined;
      if (!ctx || !edge || !line) return null; // not reachable from the start: nothing to drill
      let fen: string;
      try {
        fen = playFrom(START_FEN, line);
      } catch {
        return null;
      }
      return {
        card,
        kind: 'repertoire_move',
        repertoire: ctx.info,
        line,
        startFen: START_FEN,
        fen,
        answer: { san: edge.san, uci: edge.uci, comment: edge.comment },
        nice: edge.priority === 'nice' || ctx.nice.get(edge.fromKey) === true,
        alternatives: (ctx.byFrom.get(edge.fromKey) ?? []).filter((e) => e.isMyMove && e.id !== edge.id).map((e) => ({ san: e.san, uci: e.uci })),
      };
    },
  };
}

function playFrom(fen: string, sans: string[]): string {
  let node = createGame(fen).root;
  for (const san of sans) node = playMove(node, san);
  return node.fen;
}

export interface QueueSummary {
  /** Cards to review today (already seen before). */
  repertoireDue: number;
  positionsDue: number;
  /** New cards still to introduce today. */
  newToday: number;
  /** Cards that exist at all. */
  total: number;
}

/**
 * Whether a card is up today. A card in review is due on a day, so any time today counts; a card in a
 * learning step (minutes after a miss) waits for its minutes. The summary and the queue both use this,
 * so the count on the overview is what a session then shows.
 */
function isDue(card: CardRow, now: Date): boolean {
  if (card.state === 0) return false;
  return card.state === State.Review ? card.due <= endOfDay(now) : card.due <= now.toISOString();
}

export function summary(db: Db, now = new Date(), newPerDay = 20): QueueSummary {
  syncCards(db, now);
  const cards = activeCards(db);
  const seen = cards.filter((c) => isDue(c, now));
  const fresh = cards.filter((c) => c.state === 0).length;
  return {
    repertoireDue: seen.filter((c) => c.targetType === 'repertoire_move').length,
    positionsDue: seen.filter((c) => c.targetType === 'saved_position').length,
    newToday: Math.min(fresh, Math.max(0, newPerDay - newSeenToday(db, now))),
    total: cards.length,
  };
}

/**
 * The cards to show now: those due (learning steps of a few minutes included),
 * then new ones up to the day's limit, shallowest lines first.
 */
export function queue(
  db: Db,
  options: { now?: Date; newPerDay?: number; repertoireId?: string; type?: 'repertoire_move' | 'saved_position'; limit?: number } = {},
): CardDetail[] {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  syncCards(db, now);
  const cards = activeCards(db, options);
  const details = detailer(db);
  const shown: CardDetail[] = [];
  for (const card of cards.filter((c) => isDue(c, now)).sort((a, b) => a.due.localeCompare(b.due))) {
    if (shown.length >= limit) return shown;
    const detail = details.make(card);
    if (detail) shown.push(detail);
  }
  // New repertoire moves (shallowest lines first) and new positions take turns for the day's slots.
  const newLeft = Math.min(limit - shown.length, Math.max(0, (options.newPerDay ?? 20) - newSeenToday(db, now)));
  // Must-know moves first, then nice-to-know ones; the shallowest lines first within each.
  const moves = cards
    .filter((c) => c.state === 0 && c.targetType === 'repertoire_move')
    .map((card) => ({ card, depth: details.depth(card), nice: details.nice(card) }))
    .filter((m): m is { card: CardRow; depth: number; nice: boolean } => m.depth !== undefined)
    .sort((a, b) => Number(a.nice) - Number(b.nice) || a.depth - b.depth)
    .map((m) => m.card);
  const positions = cards.filter((c) => c.state === 0 && c.targetType === 'saved_position');
  const next = (list: CardRow[], from: { i: number }): CardDetail | null => {
    while (from.i < list.length) {
      const detail = details.make(list[from.i++]!);
      if (detail) return detail;
    }
    return null;
  };
  const inMoves = { i: 0 };
  const inPositions = { i: 0 };
  let added = 0;
  while (added < newLeft && (inMoves.i < moves.length || inPositions.i < positions.length)) {
    const move = next(moves, inMoves);
    if (move) {
      shown.push(move);
      added += 1;
    }
    const position = added < newLeft ? next(positions, inPositions) : null;
    if (position) {
      shown.push(position);
      added += 1;
    }
  }
  return shown;
}

export const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

/** Records an answer and schedules the card's next review. */
export function review(db: Db, cardId: string, rating: 1 | 2 | 3 | 4, correct: boolean, now = new Date()): CardRow | undefined {
  const row = db.select().from(trainingCards).where(eq(trainingCards.id, cardId)).get();
  if (!row) return undefined;
  const nice = row.targetType === 'repertoire_move' && detailer(db).nice(row);
  const next = (nice ? niceScheduler : scheduler).next(toFsrs(row), now, rating as Grade);
  db.transaction((tx) => {
    tx.update(trainingCards).set(fromFsrs(next.card)).where(eq(trainingCards.id, cardId)).run();
    tx.insert(trainingReviews).values({ cardId, rating, correct, reviewedAt: now.toISOString() }).run();
  });
  return db.select().from(trainingCards).where(eq(trainingCards.id, cardId)).get();
}

export interface TrainingStats {
  /** Reviews per day for the last 14 days. */
  days: { day: string; reviews: number; correct: number }[];
  byRepertoire: { id: string; name: string; color: Color; cards: number; reviews: number; accuracy: number | null }[];
  positions: { cards: number; reviews: number; accuracy: number | null };
  /** The cards missed most, with how to find them. */
  weakest: { cardId: string; label: string; lapses: number; reviews: number; accuracy: number }[];
}

export function stats(db: Db, now = new Date()): TrainingStats {
  syncCards(db, now);
  const since = new Date(now.getTime() - 13 * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const reviews = db
    .select({ cardId: trainingReviews.cardId, correct: trainingReviews.correct, at: trainingReviews.reviewedAt })
    .from(trainingReviews)
    .all();
  const recent = reviews.filter((r) => r.at >= since.toISOString());
  // Days are cut at local midnight, so they are named and grouped by the local date too.
  const byDay = new Map<string, typeof recent>();
  for (const r of recent) {
    const day = localDay(new Date(r.at));
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    const day = localDay(d);
    const list = byDay.get(day) ?? [];
    return { day, reviews: list.length, correct: list.filter((r) => r.correct).length };
  });

  const cards = activeCards(db);
  const details = detailer(db);
  const perCard = new Map<string, { reviews: number; correct: number }>();
  for (const r of reviews) {
    const s = perCard.get(r.cardId) ?? { reviews: 0, correct: 0 };
    s.reviews += 1;
    if (r.correct) s.correct += 1;
    perCard.set(r.cardId, s);
  }
  const accuracy = (ids: string[]) => {
    let total = 0;
    let right = 0;
    for (const id of ids) {
      const s = perCard.get(id);
      if (s) {
        total += s.reviews;
        right += s.correct;
      }
    }
    return { reviews: total, accuracy: total ? right / total : null };
  };

  // Counted without building each card (a large repertoire has thousands): a repertoire card counts
  // when its position can be reached from the start.
  const reachable = cards.filter((c) => c.targetType === 'repertoire_move' && details.depth(c) !== undefined);
  const byRepertoire = listRepertoires(db).map((r) => {
    const ids = reachable.filter((c) => details.repertoireOf(c) === r.id).map((c) => c.id);
    return { id: r.id, name: r.name, color: r.color, cards: ids.length, ...accuracy(ids) };
  });
  const positionIds = cards.filter((c) => c.targetType === 'saved_position').map((c) => c.id);

  // The cards most often missed, built only for the ten shown.
  const missed = cards
    .map((card) => ({ card, s: perCard.get(card.id) }))
    .filter((m): m is { card: CardRow; s: { reviews: number; correct: number } } => !!m.s && m.s.reviews > 0 && m.s.correct < m.s.reviews)
    .sort((a, b) => a.s.correct / a.s.reviews - b.s.correct / b.s.reviews || b.card.lapses - a.card.lapses);
  const weakest: { cardId: string; label: string; lapses: number; reviews: number; accuracy: number }[] = [];
  for (const { card, s } of missed) {
    if (weakest.length >= 10) break;
    const d = details.make(card);
    if (!d) continue;
    const label = d.kind === 'repertoire_move' ? `${d.repertoire.name}: ${[...d.line, `(${d.answer.san})`].join(' ')}` : d.saved.title;
    weakest.push({ cardId: card.id, label, lapses: card.lapses, reviews: s.reviews, accuracy: s.correct / s.reviews });
  }

  return { days, byRepertoire, positions: { cards: positionIds.length, ...accuracy(positionIds) }, weakest };
}
