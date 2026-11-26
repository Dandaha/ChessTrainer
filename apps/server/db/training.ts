import { randomUUID } from 'node:crypto';
import { type Color, type RepEdge, START_FEN, createGame, playMove, positionKey, repertoireTree } from '@chess/chess-core';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Card, type Grade, Rating, type State, createEmptyCard, fsrs } from 'ts-fsrs';
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
  const empty = fromFsrs(createEmptyCard(now));
  db.transaction((tx) => {
    for (const w of wanted) {
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

/** How many cards seen for the first time today. */
function newSeenToday(db: Db, now: Date): number {
  return (
    db
      .select({ n: sql<number>`count(distinct ${trainingReviews.cardId})` })
      .from(trainingReviews)
      .innerJoin(trainingCards, eq(trainingCards.id, trainingReviews.cardId))
      .where(and(sql`${trainingReviews.reviewedAt} >= ${startOfDay(now)}`, eq(trainingCards.reps, 1)))
      .get()?.n ?? 0
  );
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
  alternatives: { san: string; uci: string }[];
}

export interface PositionCardDetail {
  card: CardRow;
  kind: 'saved_position';
  saved: SavedPosition;
}

export type CardDetail = RepertoireCardDetail | PositionCardDetail;

/** For each repertoire, the moves leading to every position it reaches (shortest order first). */
function linesTo(edges: RepEdge[]): Map<string, string[]> {
  const paths = new Map<string, string[]>([[positionKey(START_FEN), []]]);
  const walk = (nodes: ReturnType<typeof repertoireTree>, trail: string[]) => {
    for (const n of nodes) {
      const path = [...trail, n.edge.san];
      if (!paths.has(n.edge.toKey)) paths.set(n.edge.toKey, path);
      if (!n.transposition) walk(n.children, path);
    }
  };
  walk(repertoireTree(edges), []);
  return paths;
}

function details(db: Db, cards: CardRow[]): CardDetail[] {
  const repIds = cards.filter((c) => c.targetType === 'repertoire_move').map((c) => c.targetId);
  const moveRows = repIds.length
    ? db.select({ id: repertoireMoves.id, repertoireId: repertoireMoves.repertoireId }).from(repertoireMoves).where(inArray(repertoireMoves.id, repIds)).all()
    : [];
  const byRepertoire = new Map<string, { edges: RepEdge[]; lines: Map<string, string[]>; info: { id: string; name: string; color: Color } }>();
  const repertoireList = listRepertoires(db);
  for (const id of new Set(moveRows.map((m) => m.repertoireId))) {
    const edges = getEdges(db, id);
    const info = repertoireList.find((r) => r.id === id)!;
    byRepertoire.set(id, { edges, lines: linesTo(edges), info: { id, name: info.name, color: info.color } });
  }
  const out: CardDetail[] = [];
  for (const card of cards) {
    if (card.targetType === 'saved_position') {
      const saved = getSavedPosition(db, card.targetId);
      if (saved) out.push({ card, kind: 'saved_position', saved });
      continue;
    }
    const repId = moveRows.find((m) => m.id === card.targetId)?.repertoireId;
    const rep = repId ? byRepertoire.get(repId) : undefined;
    const edge = rep?.edges.find((e) => e.id === card.targetId);
    const line = edge ? rep!.lines.get(edge.fromKey) : undefined;
    if (!rep || !edge || !line) continue; // not reachable from the start: nothing to drill
    let fen = START_FEN;
    try {
      fen = playFrom(START_FEN, line);
    } catch {
      continue;
    }
    out.push({
      card,
      kind: 'repertoire_move',
      repertoire: rep.info,
      line,
      startFen: START_FEN,
      fen,
      answer: { san: edge.san, uci: edge.uci, comment: edge.comment },
      alternatives: rep.edges.filter((e) => e.fromKey === edge.fromKey && e.isMyMove && e.id !== edge.id).map((e) => ({ san: e.san, uci: e.uci })),
    });
  }
  return out;
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

export function summary(db: Db, now = new Date(), newPerDay = 20): QueueSummary {
  syncCards(db, now);
  const cards = activeCards(db);
  const end = endOfDay(now);
  const seen = cards.filter((c) => c.state !== 0 && c.due <= end);
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
  syncCards(db, now);
  const cards = activeCards(db, options);
  const due = cards.filter((c) => c.state !== 0 && c.due <= now.toISOString()).sort((a, b) => a.due.localeCompare(b.due));
  const newLeft = Math.max(0, (options.newPerDay ?? 20) - newSeenToday(db, now));
  const fresh = details(db, cards.filter((c) => c.state === 0))
    .sort((a, b) => (a.kind === 'repertoire_move' ? a.line.length : 99) - (b.kind === 'repertoire_move' ? b.line.length : 99))
    .slice(0, newLeft);
  return [...details(db, due), ...fresh].slice(0, options.limit ?? 200);
}

export const RATINGS = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;

/** Records an answer and schedules the card's next review. */
export function review(db: Db, cardId: string, rating: 1 | 2 | 3 | 4, correct: boolean, now = new Date()): CardRow | undefined {
  const row = db.select().from(trainingCards).where(eq(trainingCards.id, cardId)).get();
  if (!row) return undefined;
  const next = scheduler.next(toFsrs(row), now, rating as Grade);
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
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000);
    const day = d.toISOString().slice(0, 10);
    const list = recent.filter((r) => r.at.slice(0, 10) === day);
    return { day, reviews: list.length, correct: list.filter((r) => r.correct).length };
  });

  const cards = activeCards(db);
  const cardDetails = details(db, cards);
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

  const byRepertoire = listRepertoires(db).map((r) => {
    const ids = cardDetails.filter((d) => d.kind === 'repertoire_move' && d.repertoire.id === r.id).map((d) => d.card.id);
    return { id: r.id, name: r.name, color: r.color, cards: ids.length, ...accuracy(ids) };
  });
  const positionIds = cardDetails.filter((d) => d.kind === 'saved_position').map((d) => d.card.id);

  const weakest = cardDetails
    .map((d) => {
      const s = perCard.get(d.card.id);
      if (!s || s.reviews === 0) return null;
      const label =
        d.kind === 'repertoire_move'
          ? `${d.repertoire.name}: ${[...d.line, `(${d.answer.san})`].join(' ')}`
          : d.saved.title;
      return { cardId: d.card.id, label, lapses: d.card.lapses, reviews: s.reviews, accuracy: s.correct / s.reviews };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && x.accuracy < 1)
    .sort((a, b) => a.accuracy - b.accuracy || b.lapses - a.lapses)
    .slice(0, 10);

  return { days, byRepertoire, positions: { cards: positionIds.length, ...accuracy(positionIds) }, weakest };
}
