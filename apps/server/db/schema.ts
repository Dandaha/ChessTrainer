import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * The database schema. Every id is a UUID and every timestamp an ISO 8601
 * string, so the same tables can move to Postgres later. Each phase adds its
 * own tables in its own migration; this is phase 1.
 */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const now = () => new Date().toISOString();

/** Every unique position the app has seen; the hub every other table points at. */
export const positions = sqliteTable('positions', {
  id: id(),
  /** From packages/chess-core/positionKey.ts, never built by hand. */
  fenKey: text('fen_key').notNull().unique(),
  /** A full FEN for the position, for opening it on a board. */
  fullFen: text('full_fen').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
});

/** Imported and annotated games. The PGN is the source of truth; the other columns are for search. */
export const games = sqliteTable('games', {
  id: id(),
  pgn: text('pgn').notNull(),
  white: text('white'),
  black: text('black'),
  whiteElo: integer('white_elo'),
  blackElo: integer('black_elo'),
  result: text('result'),
  /** As PGN writes it: YYYY.MM.DD, with ?? for unknown parts. */
  date: text('date'),
  event: text('event'),
  eco: text('eco'),
  openingName: text('opening_name'),
  myColor: text('my_color', { enum: ['white', 'black'] }),
  source: text('source', { enum: ['file', 'lichess', 'chesscom', 'manual'] })
    .notNull()
    .default('manual'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
  /** Set when deleted; the row stays in the trash for 30 days. */
  deletedAt: text('deleted_at'),
});
