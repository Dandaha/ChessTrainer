import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  /** Identifies the game at its source (the Lichess or Chess.com URL, or a hash of the PGN) so a re-import skips it. */
  sourceRef: text('source_ref'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
  /** Set when deleted; the row stays in the trash for 30 days. */
  deletedAt: text('deleted_at'),
}, (t) => [index('games_source_ref_idx').on(t.sourceRef), index('games_date_idx').on(t.date)]);

// ---------------------------------------------------------------------------
// Phase 2: the game library, saved positions, sets, tags, settings.

/** Which positions each game's main line passes through, for "games that reached this position". */
export const gamePositions = sqliteTable(
  'game_positions',
  {
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    ply: integer('ply').notNull(),
    positionId: text('position_id')
      .notNull()
      .references(() => positions.id),
    /** The move the game played from this position (SAN); null after the last move. */
    nextSan: text('next_san'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.ply] }), index('game_positions_position_idx').on(t.positionId)],
);

export const collections = sqliteTable('collections', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
  deletedAt: text('deleted_at'),
});

export const collectionGames = sqliteTable(
  'collection_games',
  {
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.gameId] })],
);

export const POSITION_CATEGORIES = ['tactic', 'strategy', 'endgame', 'opening', 'calculation', 'defense'] as const;

/** Positions kept on purpose. Several saves may point at one position, each with its own idea. */
export const savedPositions = sqliteTable(
  'saved_positions',
  {
    id: id(),
    positionId: text('position_id')
      .notNull()
      .references(() => positions.id),
    /** The FEN as saved, move counters included. */
    fen: text('fen').notNull(),
    title: text('title').notNull(),
    notesMd: text('notes_md'),
    category: text('category', { enum: POSITION_CATEGORIES }),
    keyIdea: text('key_idea'),
    /** The move or line that solves it, in SAN; checked in solve mode. */
    answer: text('answer'),
    sideToSolve: text('side_to_solve', { enum: ['white', 'black'] }).notNull(),
    /** 1 (easy) to 5 (hard). */
    difficulty: integer('difficulty'),
    inTraining: integer('in_training', { mode: 'boolean' }).notNull().default(false),
    sourceGameId: text('source_game_id').references(() => games.id, { onDelete: 'set null' }),
    sourcePly: integer('source_ply'),
    /** "Carlsen – Nakamura, Wijk aan Zee 2024, move 23", filled in at save time. */
    sourceLabel: text('source_label'),
    createdAt: text('created_at').notNull().$defaultFn(now),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('saved_positions_position_idx').on(t.positionId)],
);

/** Named, ordered groups of saved positions: a lesson, "to show Dani", favourites. */
export const positionSets = sqliteTable('position_sets', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
  deletedAt: text('deleted_at'),
});

export const positionSetItems = sqliteTable(
  'position_set_items',
  {
    setId: text('set_id')
      .notNull()
      .references(() => positionSets.id, { onDelete: 'cascade' }),
    savedPositionId: text('saved_position_id')
      .notNull()
      .references(() => savedPositions.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.setId, t.savedPositionId] })],
);

export const tags = sqliteTable('tags', {
  id: id(),
  name: text('name').notNull().unique(),
});

export const TAG_TARGETS = ['game', 'saved_position', 'concept'] as const;

/** A tag on anything. target_type says which table target_id points into. */
export const taggings = sqliteTable(
  'taggings',
  {
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: TAG_TARGETS }).notNull(),
    targetId: text('target_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tagId, t.targetType, t.targetId] }), index('taggings_target_idx').on(t.targetType, t.targetId)],
);

/** App settings as key and JSON value: usernames, rating, engine path, coach model... */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ---------------------------------------------------------------------------
// Phase 3: repertoires as a graph of moves between positions.

export const repertoires = sqliteTable('repertoires', {
  id: id(),
  name: text('name').notNull(),
  color: text('color', { enum: ['white', 'black'] }).notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
  deletedAt: text('deleted_at'),
});

/** One move of a repertoire: an edge from one position to the next. */
export const repertoireMoves = sqliteTable(
  'repertoire_moves',
  {
    id: id(),
    repertoireId: text('repertoire_id')
      .notNull()
      .references(() => repertoires.id, { onDelete: 'cascade' }),
    fromPositionId: text('from_position_id')
      .notNull()
      .references(() => positions.id),
    toPositionId: text('to_position_id')
      .notNull()
      .references(() => positions.id),
    san: text('san').notNull(),
    uci: text('uci').notNull(),
    /** My move (to remember) or a move the opponent is expected to play. */
    isMyMove: integer('is_my_move', { mode: 'boolean' }).notNull(),
    /** The main line from its position; other moves from there are sidelines. */
    isMain: integer('is_main', { mode: 'boolean' }).notNull().default(false),
    priority: text('priority', { enum: ['must', 'nice'] }).notNull().default('must'),
    commentMd: text('comment_md'),
    /** JSON array of NAG numbers. */
    nags: text('nags').notNull().default('[]'),
    createdAt: text('created_at').notNull().$defaultFn(now),
    updatedAt: text('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('repertoire_moves_edge_idx').on(t.repertoireId, t.fromPositionId, t.uci),
    index('repertoire_moves_from_idx').on(t.fromPositionId),
  ],
);
