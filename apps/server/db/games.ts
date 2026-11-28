import { createHash, randomUUID } from 'node:crypto';
import {
  type Game,
  type PgnError,
  getHeader,
  mainlineFrom,
  parseGame,
  parsePgn,
  positionKey,
  writePgn,
} from '@chess/chess-core';
import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { collectionGames, collections, gamePositions, games, positions, taggings, tags } from './schema.ts';
import { setTags, tagsFor } from './tags.ts';
import { containsText } from './search.ts';

export type GameSource = 'file' | 'lichess' | 'chesscom' | 'manual';

export interface GameSummary {
  id: string;
  white: string | null;
  black: string | null;
  whiteElo: number | null;
  blackElo: number | null;
  result: string | null;
  date: string | null;
  event: string | null;
  eco: string | null;
  openingName: string | null;
  myColor: 'white' | 'black' | null;
  source: GameSource;
  tags: string[];
  createdAt: string;
}

export interface GameDetail extends GameSummary {
  pgn: string;
  notes: string | null;
  collectionIds: string[];
}

export interface GameFilters {
  /** Free text: players, event, opening, notes. */
  q?: string;
  player?: string;
  /** Opening name or ECO code. */
  opening?: string;
  result?: string;
  dateFrom?: string;
  dateTo?: string;
  tag?: string;
  collectionId?: string;
  /** Only games whose main line reached this position. */
  fen?: string;
  myColor?: 'white' | 'black';
  source?: GameSource;
  sort?: 'date' | 'added';
  limit?: number;
  offset?: number;
}

export interface ImportOptions {
  source: GameSource;
  /** My own names on the sites (from Settings): a game one of them played gets "my colour". */
  myNames?: string[];
  collectionId?: string;
}

export interface ImportReport {
  imported: number;
  /** Already in the library (same source game or identical PGN). */
  duplicates: number;
  /** Chess960, crazyhouse, three-check and other variants: left out, the library is standard chess. */
  variants: number;
  errors: PgnError[];
  gameIds: string[];
}

const summaryColumns = {
  id: games.id,
  white: games.white,
  black: games.black,
  whiteElo: games.whiteElo,
  blackElo: games.blackElo,
  result: games.result,
  date: games.date,
  event: games.event,
  eco: games.eco,
  openingName: games.openingName,
  myColor: games.myColor,
  source: games.source,
  createdAt: games.createdAt,
};

function header(game: Game, name: string): string | null {
  const value = getHeader(game, name)?.trim();
  return value && value !== '?' && value !== '????.??.??' ? value : null;
}

function elo(game: Game, name: string): number | null {
  const n = Number.parseInt(header(game, name) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Addresses that name one game: a Lichess game or study chapter, a Chess.com game. Other Site values
 * (a club's or a database's home page) are shared by many games and say nothing about which one.
 */
const SINGLE_GAME_URL = [
  /^https?:\/\/(www\.)?lichess\.org\/[A-Za-z0-9]{8}([/?#]|$)/,
  /^https?:\/\/(www\.)?lichess\.org\/study\/[A-Za-z0-9]{8}\/[A-Za-z0-9]{8}([/?#]|$)/,
  /^https?:\/\/(www\.)?chess\.com\/(game\/(live|daily)|(live|daily)\/game)\/\d+([/?#]|$)/,
];

/** Where a game came from, so importing it again is recognised: its own address, else its text. */
function sourceRefFor(game: Game, pgn: string): string {
  for (const link of [header(game, 'Link'), header(game, 'Site')]) {
    if (link && SINGLE_GAME_URL.some((pattern) => pattern.test(link))) return link.replace(/^http:/, 'https:');
  }
  return `sha1:${createHash('sha1').update(pgn).digest('hex')}`;
}

function myColorFor(game: Game, myNames: string[] = []): 'white' | 'black' | null {
  const mine = new Set(myNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (mine.has(header(game, 'White')?.toLowerCase() ?? '')) return 'white';
  if (mine.has(header(game, 'Black')?.toLowerCase() ?? '')) return 'black';
  return null;
}

/** Variant tags that still mean ordinary chess ("From Position" is Lichess's game from a set-up). */
const STANDARD_VARIANTS = new Set(['standard', 'chess', 'normal', 'from position']);

function isStandardChess(game: Game): boolean {
  const variant = header(game, 'Variant');
  return !variant || STANDARD_VARIANTS.has(variant.trim().toLowerCase());
}

function columnsFor(game: Game) {
  return {
    white: header(game, 'White'),
    black: header(game, 'Black'),
    whiteElo: elo(game, 'WhiteElo'),
    blackElo: elo(game, 'BlackElo'),
    result: game.result,
    date: header(game, 'Date') ?? header(game, 'UTCDate'),
    event: header(game, 'Event'),
    eco: header(game, 'ECO'),
    openingName: header(game, 'Opening'),
  };
}

/** Prepared statements for writing a game's positions quickly, inside a transaction. */
function positionWriter(db: Db) {
  const sqlite = db.$client;
  const insertPosition = sqlite.prepare(
    'INSERT INTO positions (id, fen_key, full_fen, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(fen_key) DO NOTHING',
  );
  const selectPosition = sqlite.prepare('SELECT id FROM positions WHERE fen_key = ?');
  const clear = sqlite.prepare('DELETE FROM game_positions WHERE game_id = ?');
  const insertGamePosition = sqlite.prepare(
    'INSERT INTO game_positions (game_id, ply, position_id, next_san) VALUES (?, ?, ?, ?)',
  );
  const cache = new Map<string, string>();

  const positionId = (fen: string): string => {
    const key = positionKey(fen);
    let id = cache.get(key);
    if (!id) {
      insertPosition.run(randomUUID(), key, fen, new Date().toISOString());
      id = (selectPosition.get(key) as { id: string }).id;
      cache.set(key, id);
    }
    return id;
  };

  return {
    /** Replaces the positions a game's main line passes through. */
    write(gameId: string, game: Game) {
      clear.run(gameId);
      const line = mainlineFrom(game.root);
      line.forEach((node, i) => {
        insertGamePosition.run(gameId, node.ply, positionId(node.fen), line[i + 1]?.san ?? null);
      });
    },
  };
}

/** Imports every game in a PGN text. Games already in the library are skipped. */
export function importGames(db: Db, text: string, options: ImportOptions): ImportReport {
  const { games: parsed, errors } = parsePgn(text);
  const report: ImportReport = { imported: 0, duplicates: 0, variants: 0, errors, gameIds: [] };
  const writer = positionWriter(db);

  db.transaction((tx) => {
    let order = options.collectionId
      ? (tx
          .select({ n: sql<number>`coalesce(max(${collectionGames.sortOrder}), 0)` })
          .from(collectionGames)
          .where(eq(collectionGames.collectionId, options.collectionId))
          .get()?.n ?? 0)
      : 0;
    for (const game of parsed) {
      if (!isStandardChess(game)) {
        report.variants += 1;
        continue;
      }
      const pgn = writePgn(game);
      const sourceRef = sourceRefFor(game, pgn);
      const existing = tx
        .select({ id: games.id, deletedAt: games.deletedAt })
        .from(games)
        .where(eq(games.sourceRef, sourceRef))
        .get();
      let id: string;
      if (existing && !existing.deletedAt) {
        report.duplicates += 1;
        id = existing.id;
      } else if (existing) {
        // Imported before and then deleted: importing it again brings it back.
        tx.update(games).set({ deletedAt: null, updatedAt: new Date().toISOString() }).where(eq(games.id, existing.id)).run();
        report.imported += 1;
        id = existing.id;
      } else {
        id = randomUUID();
        tx.insert(games)
          .values({
            id,
            pgn,
            ...columnsFor(game),
            myColor: myColorFor(game, options.myNames),
            source: options.source,
            sourceRef,
          })
          .run();
        writer.write(id, game);
        report.imported += 1;
      }
      report.gameIds.push(id);
      if (options.collectionId) {
        order += 1;
        tx.insert(collectionGames)
          .values({ collectionId: options.collectionId, gameId: id, sortOrder: order })
          .onConflictDoNothing()
          .run();
      }
    }
  });
  return report;
}

/**
 * Saves a game edited on the board: a new game when there is no id, otherwise
 * the PGN of an existing one, with its search columns and positions rebuilt.
 */
export function saveGame(db: Db, input: { id?: string; pgn: string }): string {
  const game = parseGame(input.pgn);
  const pgn = writePgn(game);
  const writer = positionWriter(db);
  return db.transaction((tx) => {
    if (input.id) {
      tx.update(games)
        .set({ pgn, ...columnsFor(game), updatedAt: new Date().toISOString() })
        .where(eq(games.id, input.id))
        .run();
      writer.write(input.id, game);
      return input.id;
    }
    const id = randomUUID();
    tx.insert(games)
      .values({ id, pgn, ...columnsFor(game), source: 'manual', sourceRef: `manual:${id}` })
      .run();
    writer.write(id, game);
    return id;
  });
}

/**
 * Changes a library game: its moves (PGN), notes, "my colour" and tags, all in one transaction, so a
 * change that fails part-way leaves the game as it was.
 */
export function updateGame(
  db: Db,
  id: string,
  changes: { pgn?: string; notes?: string | null; tags?: string[]; myColor?: 'white' | 'black' | null },
): void {
  // Parsed before anything is written: a PGN that does not read stops here with a 400.
  const game = changes.pgn ? parseGame(changes.pgn) : null;
  const writer = positionWriter(db);
  db.transaction((tx) => {
    const set: Partial<typeof games.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (game) Object.assign(set, { pgn: writePgn(game), ...columnsFor(game) });
    if (changes.notes !== undefined) set.notes = changes.notes;
    if (changes.myColor !== undefined) set.myColor = changes.myColor;
    tx.update(games).set(set).where(eq(games.id, id)).run();
    if (game) writer.write(id, game);
    if (changes.tags) setTags(tx as unknown as Db, 'game', id, changes.tags);
  });
}

function positionIdFor(db: Db, fen: string): string | undefined {
  return db.select({ id: positions.id }).from(positions).where(eq(positions.fenKey, positionKey(fen))).get()?.id;
}

function conditions(db: Db, f: GameFilters): SQL[] | null {
  const where: SQL[] = [isNull(games.deletedAt)];
  if (f.q) {
    const q = f.q;
    where.push(
      or(
        containsText(games.white, q),
        containsText(games.black, q),
        containsText(games.event, q),
        containsText(games.openingName, q),
        containsText(games.eco, q),
        containsText(games.notes, q),
      )!,
    );
  }
  if (f.player) where.push(or(containsText(games.white, f.player), containsText(games.black, f.player))!);
  if (f.opening) {
    const code = f.opening.trim().toUpperCase();
    where.push(
      /^[A-E]\d{0,2}$/.test(code)
        ? like(games.eco, `${code}%`)
        : or(containsText(games.openingName, f.opening), containsText(games.eco, f.opening))!,
    );
  }
  if (f.result) where.push(eq(games.result, f.result));
  if (f.dateFrom) where.push(sql`${games.date} >= ${f.dateFrom.replace(/-/g, '.')}`);
  if (f.dateTo) where.push(sql`${games.date} <= ${`${f.dateTo.replace(/-/g, '.')}~`}`);
  if (f.myColor) where.push(eq(games.myColor, f.myColor));
  if (f.source) where.push(eq(games.source, f.source));
  if (f.collectionId) {
    where.push(
      inArray(
        games.id,
        db.select({ id: collectionGames.gameId }).from(collectionGames).where(eq(collectionGames.collectionId, f.collectionId)),
      ),
    );
  }
  if (f.tag) {
    where.push(
      inArray(
        games.id,
        db
          .select({ id: taggings.targetId })
          .from(taggings)
          .innerJoin(tags, eq(tags.id, taggings.tagId))
          .where(and(eq(taggings.targetType, 'game'), eq(tags.name, f.tag.trim().toLowerCase()))),
      ),
    );
  }
  if (f.fen) {
    const positionId = positionIdFor(db, f.fen);
    if (!positionId) return null; // the position was never seen: no game reached it
    where.push(
      inArray(games.id, db.select({ id: gamePositions.gameId }).from(gamePositions).where(eq(gamePositions.positionId, positionId))),
    );
  }
  return where;
}

function withTags<T extends { id: string }>(db: Db, rows: T[]): (T & { tags: string[] })[] {
  const byId = tagsFor(db, 'game', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, tags: byId.get(r.id) ?? [] }));
}

export function listGames(db: Db, f: GameFilters = {}): { total: number; games: GameSummary[] } {
  const where = conditions(db, f);
  if (!where) return { total: 0, games: [] };
  const total = db.select({ n: sql<number>`count(*)` }).from(games).where(and(...where)).get()?.n ?? 0;
  let order: SQL[] = f.sort === 'added' ? [desc(games.createdAt)] : [desc(games.date), desc(games.createdAt)];
  if (f.collectionId) {
    // A collection keeps its own order.
    order = [
      asc(
        sql`(select cg.sort_order from collection_games cg where cg.game_id = games.id and cg.collection_id = ${f.collectionId})`,
      ),
    ];
  }
  const rows = db
    .select(summaryColumns)
    .from(games)
    .where(and(...where))
    .orderBy(...order)
    .limit(Math.min(f.limit ?? 50, 500))
    .offset(f.offset ?? 0)
    .all();
  return { total, games: withTags(db, rows) };
}

export function getGame(db: Db, id: string): GameDetail | undefined {
  const row = db
    .select({ ...summaryColumns, pgn: games.pgn, notes: games.notes })
    .from(games)
    .where(and(eq(games.id, id), isNull(games.deletedAt)))
    .get();
  if (!row) return undefined;
  const collectionIds = db
    .select({ id: collectionGames.collectionId })
    .from(collectionGames)
    .innerJoin(collections, eq(collections.id, collectionGames.collectionId))
    .where(and(eq(collectionGames.gameId, id), isNull(collections.deletedAt)))
    .all()
    .map((r) => r.id);
  return { ...row, tags: tagsFor(db, 'game', [id]).get(id) ?? [], collectionIds };
}

export interface MoveStat {
  san: string;
  games: number;
  whiteWins: number;
  draws: number;
  blackWins: number;
}

/** Games in the library that reached a position, with the moves played from it. */
export function gamesAtPosition(
  db: Db,
  fen: string,
  limit = 50,
): { total: number; moves: MoveStat[]; games: (GameSummary & { ply: number; nextSan: string | null })[] } {
  const positionId = positionIdFor(db, fen);
  if (!positionId) return { total: 0, moves: [], games: [] };
  const live = and(eq(gamePositions.positionId, positionId), isNull(games.deletedAt));

  const moves = db
    .select({
      san: gamePositions.nextSan,
      games: sql<number>`count(distinct ${games.id})`,
      whiteWins: sql<number>`count(distinct case when ${games.result} = '1-0' then ${games.id} end)`,
      draws: sql<number>`count(distinct case when ${games.result} = '1/2-1/2' then ${games.id} end)`,
      blackWins: sql<number>`count(distinct case when ${games.result} = '0-1' then ${games.id} end)`,
    })
    .from(gamePositions)
    .innerJoin(games, eq(games.id, gamePositions.gameId))
    .where(and(live, isNotNull(gamePositions.nextSan)))
    .groupBy(gamePositions.nextSan)
    .orderBy(sql`count(distinct ${games.id}) desc`)
    .all() as MoveStat[];

  const total =
    db
      .select({ n: sql<number>`count(distinct ${games.id})` })
      .from(gamePositions)
      .innerJoin(games, eq(games.id, gamePositions.gameId))
      .where(live)
      .get()?.n ?? 0;

  const rows = db
    .select({ ...summaryColumns, ply: sql<number>`min(${gamePositions.ply})`, nextSan: gamePositions.nextSan })
    .from(gamePositions)
    .innerJoin(games, eq(games.id, gamePositions.gameId))
    .where(live)
    .groupBy(games.id)
    .orderBy(desc(games.date))
    .limit(limit)
    .all();
  return { total, moves, games: withTags(db, rows) };
}

export function softDeleteGames(db: Db, ids: string[]): void {
  if (!ids.length) return;
  db.update(games).set({ deletedAt: new Date().toISOString() }).where(inArray(games.id, ids)).run();
}
