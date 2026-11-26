import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { findOrCreatePosition } from './positions.ts';
import { coachMessages, positions } from './schema.ts';

/** The coach's history per position, with the tokens of every answer. */

export function recordExchange(
  db: Db,
  input: {
    fen: string;
    mode: string;
    question: string;
    answer: string;
    model: string;
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
    trace: unknown;
  },
): string {
  const position = findOrCreatePosition(db, input.fen);
  const answerId = randomUUID();
  const asked = new Date();
  db.transaction((tx) => {
    tx.insert(coachMessages)
      .values({ positionId: position.id, role: 'user', mode: input.mode, content: input.question, createdAt: asked.toISOString() })
      .run();
    tx.insert(coachMessages)
      .values({
        id: answerId,
        positionId: position.id,
        role: 'assistant',
        mode: input.mode,
        model: input.model,
        content: input.answer,
        toolTraceJson: JSON.stringify(input.trace),
        inputTokens: input.usage.input,
        outputTokens: input.usage.output,
        cacheReadTokens: input.usage.cacheRead,
        cacheWriteTokens: input.usage.cacheWrite,
        createdAt: new Date(asked.getTime() + 1).toISOString(),
      })
      .run();
  });
  return answerId;
}

export interface CoachHistoryItem {
  id: string;
  role: 'user' | 'assistant';
  mode: string;
  model: string | null;
  content: string;
  trace: unknown;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

/** What the coach was asked about a position, oldest first. */
export function historyAt(db: Db, fen: string, positionKeyOf: (fen: string) => string): CoachHistoryItem[] {
  const position = db.select({ id: positions.id }).from(positions).where(eq(positions.fenKey, positionKeyOf(fen))).get();
  if (!position) return [];
  return db
    .select()
    .from(coachMessages)
    .where(eq(coachMessages.positionId, position.id))
    .orderBy(coachMessages.createdAt)
    .all()
    .map((m) => ({
      id: m.id,
      role: m.role,
      mode: m.mode,
      model: m.model,
      content: m.content,
      trace: m.toolTraceJson ? JSON.parse(m.toolTraceJson) : null,
      inputTokens: m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens,
      outputTokens: m.outputTokens,
      createdAt: m.createdAt,
    }));
}

/** Token totals per model since a date, for the spending note. */
export function tokensSince(db: Db, since: Date) {
  return db
    .select({
      model: coachMessages.model,
      answers: sql<number>`count(*)`,
      input: sql<number>`sum(${coachMessages.inputTokens})`,
      output: sql<number>`sum(${coachMessages.outputTokens})`,
      cacheRead: sql<number>`sum(${coachMessages.cacheReadTokens})`,
      cacheWrite: sql<number>`sum(${coachMessages.cacheWriteTokens})`,
    })
    .from(coachMessages)
    .where(and(eq(coachMessages.role, 'assistant'), gte(coachMessages.createdAt, since.toISOString())))
    .groupBy(coachMessages.model)
    .orderBy(desc(sql`count(*)`))
    .all();
}
