import { createHash, randomUUID } from 'node:crypto';
import {
  type Game,
  type PgnError,
  getHeader,
  mainlineFrom,
  parseGame,
  parsePgn,
  playedPositionKey,
  positionHash,
  positionKey,
  readPgnGames,
  type Speed,
  speedOf,
  writePgn,
} from '@chess/chess-core';
import { classifyOpening } from '@chess/chess-core/openings';
import { type SQL, and, asc, desc, eq, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { collectionGames, collections, gamePositions, games, taggings, tags } from './schema.ts';
import { setTags, tagsFor } from './tags.ts';
import { containsWords } from './search.ts';

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
  timeControl: string | null;
  speed: Speed | null;
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
  speed?: Speed;
  /** Only the games one import brought in: the last import. */
  importId?: string;
  /** Only games added since this time (ISO): the last import of a library from before imports had ids. */
  since?: string;
  /** The TimeControl tag exactly, such as "180+2". */
  timeControl?: string;
  /** A column to sort by; the newest first when none is given (a collection: its own order). */
  sort?: GameSort;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ImportOptions {
  source: GameSource;
  /** My own names on the sites (from Settings): a game one of them played gets "my colour". */
  myNames?: string[];
  collectionId?: string;
  /** Marks every game the import brings in or back, so "Last import" lists exactly those. */
  importId?: string;
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
  timeControl: games.timeControl,
  speed: games.speed,
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

/** The same game wherever it came from: players, year, result and moves, without notes or other tags. */
function contentKeyFor(game: Game): string {
  const name = (tag: string) => (header(game, tag) ?? '?').toLowerCase().replace(/\s+/g, ' ');
  const year = (header(game, 'Date') ?? header(game, 'UTCDate') ?? '????').slice(0, 4);
  const moves = mainlineFrom(game.root)
    .slice(1)
    .map((n) => n.san)
    .join(' ');
  return `sha1:${createHash('sha1').update([name('White'), name('Black'), year, game.result, game.root.fen, moves].join('|')).digest('hex')}`;
}

/** The ECO code and opening name: the game's own tags, else what its moves reach in the opening table. */
function openingFor(game: Game): { eco: string | null; openingName: string | null } {
  const eco = header(game, 'ECO');
  const openingName = header(game, 'Opening');
  if (eco && openingName) return { eco, openingName };
  const named = classifyOpening(mainlineFrom(game.root).map((n) => n.fen));
  return { eco: eco ?? named?.eco ?? null, openingName: openingName ?? named?.name ?? null };
}

function columnsFor(game: Game) {
  return {
    contentKey: contentKeyFor(game),
    white: header(game, 'White'),
    black: header(game, 'Black'),
    whiteElo: elo(game, 'WhiteElo'),
    blackElo: elo(game, 'BlackElo'),
    result: game.result,
    date: header(game, 'Date') ?? header(game, 'UTCDate'),
    time: header(game, 'UTCTime') ?? header(game, 'Time'),
    timeControl: header(game, 'TimeControl'),
    speed: speedOf(header(game, 'TimeControl'), header(game, 'Event')),
    event: header(game, 'Event'),
    ...openingFor(game),
  };
}

/** Prepared statements for writing a game's positions quickly, inside a transaction. */
function positionWriter(db: Db) {
  const sqlite = db.$client;
  const clear = sqlite.prepare('DELETE FROM game_positions WHERE game_id = ?');
  const insert = sqlite.prepare('INSERT INTO game_positions (game_id, ply, position_hash, next_san) VALUES (?, ?, ?, ?)');
  return {
    /** Replaces the positions a game's main line passes through. */
    write(gameId: string, game: Game) {
      clear.run(gameId);
      const line = mainlineFrom(game.root);
      line.forEach((node, i) => {
        insert.run(gameId, node.ply, positionHash(playedPositionKey(node.fen)), line[i + 1]?.san ?? null);
      });
    },
  };
}

/** Imports every game in a PGN text. Games already in the library are skipped. */
/** Writes a batch of parsed games in one transaction, adding to the report. */
function writeGames(db: Db, parsed: Game[], options: ImportOptions, report: ImportReport): void {
  const writer = positionWriter(db);
  db.transaction((tx) => {
    // Appended after the collection's last game, which a previous batch may have just added.
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
        tx.update(games)
          .set({ deletedAt: null, updatedAt: new Date().toISOString(), importId: options.importId ?? null })
          .where(eq(games.id, existing.id))
          .run();
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
            importId: options.importId ?? null,
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
}

/** Imports every game of a PGN text in one go: for small texts and tests. */
export function importGames(db: Db, text: string, options: ImportOptions): ImportReport {
  const { games: parsed, errors } = parsePgn(text);
  const report: ImportReport = { imported: 0, duplicates: 0, variants: 0, errors, gameIds: [] };
  writeGames(db, parsed, options, report);
  return report;
}

/** How long one batch may keep the server busy before it lets other requests through. */
const BATCH_MS = 100;

/**
 * Imports a PGN text in batches, each in its own transaction, handing the server back between them:
 * a library of thousands of games comes in without freezing the app, and the games stay findable as
 * they arrive. A batch that fails leaves the batches before it imported.
 */
export async function importGamesInBatches(
  db: Db,
  text: string,
  options: ImportOptions,
  onProgress?: (progress: ImportProgress) => void,
): Promise<ImportReport> {
  const report: ImportReport = { imported: 0, duplicates: 0, variants: 0, errors: [], gameIds: [] };
  const expected = countGameStarts(text) || undefined;
  const tell = () =>
    onProgress?.({ phase: 'importing', games: report.imported + report.duplicates + report.variants + report.errors.length, expected });
  let batch: Game[] = [];
  let started = performance.now();
  for (const item of readPgnGames(text)) {
    if ('error' in item) report.errors.push(item.error);
    else batch.push(item.game);
    if (performance.now() - started >= BATCH_MS) {
      writeGames(db, batch, options, report);
      batch = [];
      tell();
      await new Promise((resolve) => setImmediate(resolve));
      started = performance.now();
    }
  }
  writeGames(db, batch, options, report);
  tell();
  return report;
}

/** How far an import has come: games downloaded so far, or games read (and how many the text holds). */
export interface ImportProgress {
  phase: 'downloading' | 'importing';
  games: number;
  /** About how many games the text holds (its Event tags); unknown when the games have none. */
  expected?: number;
}

/** What an import streams to the browser that asked for events. */
export type ImportEvent = ({ type: 'progress' } & ImportProgress) | { type: 'done'; report: ImportReport } | { type: 'error'; error: string };

/** Games in a PGN text, counted by their Event tags (every exported game has one). */
export function countGameStarts(text: string): number {
  return text.match(/^\s*\[Event\s/gm)?.length ?? 0;
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

/** How the game index knows a position. */
function indexHash(fen: string): bigint {
  return positionHash(positionKey(fen));
}

function conditions(db: Db, f: GameFilters): SQL[] | null {
  const where: SQL[] = [isNull(games.deletedAt)];
  // Each word typed somewhere in the game; a player's words all in one player's name.
  const text = f.q ? containsWords([games.white, games.black, games.event, games.openingName, games.eco, games.notes], f.q) : undefined;
  if (text) where.push(text);
  const white = f.player ? containsWords([games.white], f.player) : undefined;
  const black = f.player ? containsWords([games.black], f.player) : undefined;
  if (white && black) where.push(or(white, black)!);
  if (f.opening) {
    const code = f.opening.trim().toUpperCase();
    where.push(
      /^[A-E]\d{0,2}$/.test(code)
        ? like(games.eco, `${code}%`)
        : (containsWords([games.openingName, games.eco], f.opening) ?? sql`1`),
    );
  }
  if (f.result) where.push(eq(games.result, f.result));
  // A date with unknown parts ("2024.??.??") is somewhere in its year: it matches when that could
  // fall in the range, its latest possible day on or after From, its earliest on or before To.
  if (f.dateFrom) where.push(sql`replace(${games.date}, '??', '99') >= ${f.dateFrom.replace(/-/g, '.')}`);
  if (f.dateTo) where.push(sql`replace(${games.date}, '??', '00') <= ${`${f.dateTo.replace(/-/g, '.')}~`}`);
  if (f.myColor) where.push(eq(games.myColor, f.myColor));
  if (f.speed) where.push(eq(games.speed, f.speed));
  if (f.importId) where.push(eq(games.importId, f.importId));
  if (f.since) where.push(sql`${games.createdAt} >= ${f.since}`);
  if (f.timeControl) where.push(eq(games.timeControl, f.timeControl));
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
    const hash = indexHash(f.fen);
    where.push(inArray(games.id, db.select({ id: gamePositions.gameId }).from(gamePositions).where(eq(gamePositions.positionHash, hash))));
  }
  return where;
}

function withTags<T extends { id: string }>(db: Db, rows: T[]): (T & { tags: string[] })[] {
  const byId = tagsFor(db, 'game', rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, tags: byId.get(r.id) ?? [] }));
}

export const GAME_SORTS = ['date', 'added', 'white', 'black', 'whiteElo', 'blackElo', 'result', 'eco', 'event'] as const;
export type GameSort = (typeof GAME_SORTS)[number];

/** The ORDER BY for a column, empty values last whichever way; ties fall back to the newest first. */
function sortOrder(sort: GameSort, dir: 'asc' | 'desc'): SQL[] {
  const way = dir === 'asc' ? sql`asc` : sql`desc`;
  const by = (expr: SQL) => sql`${expr} ${way} nulls last`;
  const newest = [sql`${games.date} desc nulls last`, sql`${games.time} desc nulls last`, desc(games.createdAt)];
  switch (sort) {
    case 'date':
      return [by(sql`${games.date}`), by(sql`${games.time}`), dir === 'asc' ? asc(games.createdAt) : desc(games.createdAt)];
    case 'added':
      return [dir === 'asc' ? asc(games.createdAt) : desc(games.createdAt)];
    case 'white':
      return [by(sql`fold(${games.white})`), ...newest];
    case 'black':
      return [by(sql`fold(${games.black})`), ...newest];
    case 'whiteElo':
      return [by(sql`${games.whiteElo}`), ...newest];
    case 'blackElo':
      return [by(sql`${games.blackElo}`), ...newest];
    case 'result':
      return [by(sql`${games.result}`), ...newest];
    case 'eco':
      return [by(sql`${games.eco}`), by(sql`fold(${games.openingName})`), ...newest];
    case 'event':
      return [by(sql`fold(${games.event})`), ...newest];
  }
}

/**
 * Every game that matches, as one PGN text in the order the list shows them: the whole filter or
 * collection, not one page. `ids` exports exactly those games, in that order.
 */
export function exportGames(db: Db, f: GameFilters & { ids?: string[] } = {}): { pgn: string; count: number } {
  let rows: { id: string; pgn: string }[];
  if (f.ids) {
    const byId = new Map(
      db
        .select({ id: games.id, pgn: games.pgn })
        .from(games)
        .where(and(inArray(games.id, f.ids), isNull(games.deletedAt)))
        .all()
        .map((r) => [r.id, r]),
    );
    rows = f.ids.map((id) => byId.get(id)).filter((r): r is { id: string; pgn: string } => r !== undefined);
  } else {
    const where = conditions(db, f);
    if (!where) return { pgn: '', count: 0 };
    let order = sortOrder(f.sort ?? 'date', f.dir ?? 'desc');
    if (f.collectionId && !f.sort) {
      order = [asc(sql`(select cg.sort_order from collection_games cg where cg.game_id = games.id and cg.collection_id = ${f.collectionId})`)];
    }
    rows = db.select({ id: games.id, pgn: games.pgn }).from(games).where(and(...where)).orderBy(...order).all();
  }
  return { pgn: rows.map((r) => r.pgn.trim()).join('\n\n') + (rows.length ? '\n' : ''), count: rows.length };
}

export function listGames(db: Db, f: GameFilters = {}): { total: number; games: GameSummary[] } {
  const where = conditions(db, f);
  if (!where) return { total: 0, games: [] };
  const total = db.select({ n: sql<number>`count(*)` }).from(games).where(and(...where)).get()?.n ?? 0;
  let order = sortOrder(f.sort ?? 'date', f.dir ?? 'desc');
  if (f.collectionId && !f.sort) {
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

/** The ids of every game a filter finds, on every page (at most 100,000). */
export function listGameIds(db: Db, f: GameFilters = {}): string[] {
  const where = conditions(db, f);
  if (!where) return [];
  return db
    .select({ id: games.id })
    .from(games)
    .where(and(...where))
    .limit(100_000)
    .all()
    .map((r) => r.id);
}

/**
 * Marks "my colour" on the games one of my names played that have none yet: a name set in Settings
 * after the games came in counts for them too. Says how many games it marked.
 */
export function fillMyColor(db: Db, myNames: string[]): number {
  const names = [...new Set(myNames.map((name) => name.trim().toLowerCase()).filter(Boolean))];
  if (!names.length) return 0;
  let marked = 0;
  db.transaction((tx) => {
    for (const [color, column] of [['white', games.white], ['black', games.black]] as const) {
      marked += tx
        .update(games)
        .set({ myColor: color })
        .where(and(isNull(games.myColor), isNull(games.deletedAt), inArray(sql`lower(trim(${column}))`, names)))
        .run().changes;
    }
  });
  return marked;
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
  const live = and(eq(gamePositions.positionHash, indexHash(fen)), isNull(games.deletedAt));

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

/** The time controls in the library, most played first, for the filter. */
export function timeControls(db: Db): { timeControl: string; speed: Speed | null; games: number }[] {
  return db
    .select({ timeControl: games.timeControl, speed: games.speed, games: sql<number>`count(*)` })
    .from(games)
    .where(and(isNull(games.deletedAt), isNotNull(games.timeControl)))
    .groupBy(games.timeControl)
    .orderBy(sql`count(*) desc`)
    .limit(40)
    .all() as { timeControl: string; speed: Speed | null; games: number }[];
}

/**
 * Fills in what games imported by an older version lack: their content key, and an opening for
 * games without one. Does up to `limit` games and says how many it did; run it until that is 0.
 */
export function deriveMissing(db: Db, limit = 200): number {
  const rows = db
    .select({ id: games.id, pgn: games.pgn, eco: games.eco, openingName: games.openingName })
    .from(games)
    .where(isNull(games.contentKey))
    .limit(limit)
    .all();
  db.transaction((tx) => {
    for (const row of rows) {
      let set: Partial<typeof games.$inferInsert>;
      try {
        const game = parseGame(row.pgn);
        const opening = openingFor(game);
        set = { contentKey: contentKeyFor(game), eco: row.eco ?? opening.eco, openingName: row.openingName ?? opening.openingName };
      } catch {
        set = { contentKey: `unreadable:${row.id}` };
      }
      tx.update(games).set(set).where(eq(games.id, row.id)).run();
    }
  });
  return rows.length;
}

/** deriveMissing in the background, a batch at a time, leaving the server free in between. */
export async function deriveMissingInBackground(db: Db): Promise<void> {
  try {
    while (db.$client.open && deriveMissing(db, 50) > 0) await new Promise((resolve) => setImmediate(resolve));
  } catch {
    // The database closed while it ran (the app quit): the rest waits for the next start.
  }
}

/** A game found more than once: the copy kept (the one with the most of my own work in it), and the others. */
export interface DuplicateGroup {
  keep: GameSummary;
  copies: GameSummary[];
}

/**
 * Which copy of a game to keep, best first: the one I put the most into (notes, tags, my colour,
 * collections), then the one with the most comments in its moves, then the oldest (the original
 * over a later copy). Longer headers alone never win: they are what a re-import adds.
 */
const keepOrder = [
  sql`(case when coalesce(trim(${games.notes}), '') <> '' then 1 else 0 end
    + case when ${games.myColor} is not null then 1 else 0 end
    + (select count(*) from ${taggings} where ${taggings.targetType} = 'game' and ${taggings.targetId} = ${games.id})
    + (select count(*) from ${collectionGames} where ${collectionGames.gameId} = ${games.id})) desc`,
  sql`length(${games.pgn}) - length(replace(${games.pgn}, '{', '')) desc`,
  asc(games.createdAt),
  // Imported in the same millisecond: the one written first.
  sql`"games"."rowid" asc`,
];

/**
 * Games that are in the library more than once, whatever their notes or tags: every extra copy (to
 * move to the trash in one go), and the first `limit` groups to show.
 */
export function findDuplicates(db: Db, limit = 200): { groups: DuplicateGroup[]; totalGroups: number; extraCopies: number; extraIds: string[] } {
  while (deriveMissing(db, 500) > 0);
  const duplicated = db
    .select({ key: games.contentKey })
    .from(games)
    .where(and(isNull(games.deletedAt), isNotNull(games.contentKey), sql`${games.contentKey} not like 'unreadable:%'`))
    .groupBy(games.contentKey)
    .having(sql`count(*) > 1`);
  const ranked = db
    .select({ id: games.id, key: games.contentKey, rank: sql<number>`row_number() over (partition by ${games.contentKey} order by ${sql.join(keepOrder, sql`, `)})` })
    .from(games)
    .where(and(isNull(games.deletedAt), inArray(games.contentKey, duplicated)))
    .all();
  const byKey = new Map<string, string[]>();
  for (const row of ranked) {
    const list = byKey.get(row.key!) ?? [];
    list[row.rank - 1] = row.id;
    byKey.set(row.key!, list);
  }
  const keys = [...byKey.keys()];
  const shown = keys.slice(0, limit);
  const summaries = new Map(
    withTags(db, shown.length ? db.select(summaryColumns).from(games).where(inArray(games.id, shown.flatMap((k) => byKey.get(k)!))).all() : []).map((g) => [g.id, g]),
  );
  const groups = shown.map((key) => {
    const [keep, ...copies] = byKey.get(key)!.map((id) => summaries.get(id)!);
    return { keep: keep!, copies };
  });
  const extraIds = keys.flatMap((key) => byKey.get(key)!.slice(1));
  return { groups, totalGroups: keys.length, extraCopies: extraIds.length, extraIds };
}
