import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { gamesAtPosition, getGame, importGames, listGames, saveGame } from '../db/games.ts';
import {
  addToSet,
  createCollection,
  createSavedPosition,
  createSet,
  listSavedPositions,
  listTrash,
  purgeTrash,
  reorderSet,
  restore,
  savesOfPosition,
  softDelete,
  updateSavedPosition,
} from '../db/library.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const TWO_GAMES = `[Event "Club"]
[Site "https://lichess.org/abcd1234"]
[Date "2026.03.01"]
[White "dave"]
[Black "Friend"]
[WhiteElo "1850"]
[Result "1-0"]
[ECO "C50"]
[Opening "Italian Game"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. c3 1-0

[Event "Blitz"]
[Site "https://lichess.org/efgh5678"]
[Date "2026.04.02"]
[White "Other"]
[Black "Dave"]
[Result "0-1"]
[ECO "C44"]

1. Nf3 Nc6 2. e4 e5 3. d4 exd4 0-1
`;

// After 1.e4 e5 2.Nf3 Nc6, reached by both games in different move orders.
const FOUR_KNIGHTS_ISH = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';

describe('the game library', () => {
  it('imports games with their players, ratings, opening and my colour', () => {
    const db = freshDb();
    const report = importGames(db, TWO_GAMES, { source: 'lichess', username: 'Dave' });
    expect(report).toMatchObject({ imported: 2, duplicates: 0, errors: [] });
    const { total, games } = listGames(db);
    expect(total).toBe(2);
    expect(games[0]).toMatchObject({ white: 'Other', black: 'Dave', myColor: 'black', result: '0-1', date: '2026.04.02' });
    expect(games[1]).toMatchObject({ white: 'dave', whiteElo: 1850, openingName: 'Italian Game', myColor: 'white' });
  });

  it('skips games already in the library when importing again', () => {
    const db = freshDb();
    importGames(db, TWO_GAMES, { source: 'lichess' });
    const again = importGames(db, TWO_GAMES, { source: 'lichess' });
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
    expect(listGames(db).total).toBe(2);
  });

  it('skips an identical game from a file even without a link', () => {
    const db = freshDb();
    const pgn = '[White "A"]\n[Black "B"]\n\n1. d4 d5 *';
    importGames(db, pgn, { source: 'file' });
    expect(importGames(db, pgn, { source: 'file' }).duplicates).toBe(1);
  });

  it('reports a broken game and imports the rest', () => {
    const db = freshDb();
    const report = importGames(db, `${TWO_GAMES}\n[Event "Bad"]\n\n1. e4 e5 2. Ke3 *\n`, { source: 'file' });
    expect(report.imported).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]!.message).toMatch(/Ke3/);
  });

  it('finds every game that reached a position, whatever the move order', () => {
    const db = freshDb();
    importGames(db, TWO_GAMES, { source: 'lichess' });
    const found = gamesAtPosition(db, FOUR_KNIGHTS_ISH);
    expect(found.total).toBe(2);
    expect(found.moves.map((m) => [m.san, m.games])).toEqual(
      expect.arrayContaining([
        ['Bc4', 1],
        ['d4', 1],
      ]),
    );
    expect(listGames(db, { fen: FOUR_KNIGHTS_ISH }).total).toBe(2);
    expect(listGames(db, { fen: '8/8/8/8/8/8/k7/K7 w - - 0 1' }).total).toBe(0);
  });

  it('filters by player, opening, ECO range, result and date', () => {
    const db = freshDb();
    importGames(db, TWO_GAMES, { source: 'lichess' });
    expect(listGames(db, { player: 'friend' }).total).toBe(1);
    expect(listGames(db, { opening: 'italian' }).total).toBe(1);
    expect(listGames(db, { opening: 'C4' }).games[0]!.eco).toBe('C44');
    expect(listGames(db, { result: '0-1' }).total).toBe(1);
    expect(listGames(db, { dateFrom: '2026-04-01' }).total).toBe(1);
    expect(listGames(db, { dateTo: '2026-03-31' }).total).toBe(1);
  });

  it('keeps a collection in its own order', () => {
    const db = freshDb();
    const collectionId = createCollection(db, { name: 'Selected classics' });
    importGames(db, TWO_GAMES, { source: 'file', collectionId });
    const { games } = listGames(db, { collectionId });
    expect(games.map((g) => g.event)).toEqual(['Club', 'Blitz']);
  });

  it('saves annotations back into a game and rebuilds its positions', () => {
    const db = freshDb();
    const id = saveGame(db, { pgn: '[White "Me"]\n\n1. e4 e5 *' });
    saveGame(db, { id, pgn: '[White "Me"]\n\n1. e4 { best by test } e5 2. Nf3 *' });
    expect(getGame(db, id)!.pgn).toContain('{ best by test }');
    expect(gamesAtPosition(db, 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2').total).toBe(1);
  });
});

describe('saved positions and sets', () => {
  const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';

  it('saves the same position twice, each with its own idea, and knows it was saved before', () => {
    const db = freshDb();
    const first = createSavedPosition(db, { fen: FEN, title: 'Fried liver idea', category: 'tactic', tags: ['Italian', 'attack'] });
    const second = createSavedPosition(db, { fen: FEN.replace(' 4 4', ' 0 9'), title: 'The endgame after' });
    expect(first.positionId).toBe(second.positionId);
    expect(first.sideToSolve).toBe('white');
    expect(first.inTraining).toBe(false);
    expect(first.tags).toEqual(['attack', 'italian']);
    expect(savesOfPosition(db, FEN, second.id).map((s) => s.title)).toEqual(['Fried liver idea']);
  });

  it('filters by text, tag, category and training', () => {
    const db = freshDb();
    createSavedPosition(db, { fen: FEN, title: 'Fried liver idea', category: 'tactic', tags: ['attack'] });
    const quiet = createSavedPosition(db, { fen: FEN, title: 'Quiet plan', category: 'strategy', keyIdea: 'Play d3 and c3' });
    updateSavedPosition(db, quiet.id, { inTraining: true });
    expect(listSavedPositions(db, { q: 'c3' }).positions.map((p) => p.title)).toEqual(['Quiet plan']);
    expect(listSavedPositions(db, { q: 'attack' }).positions.map((p) => p.title)).toEqual(['Fried liver idea']);
    expect(listSavedPositions(db, { tag: 'attack' }).total).toBe(1);
    expect(listSavedPositions(db, { category: 'strategy' }).total).toBe(1);
    expect(listSavedPositions(db, { inTraining: true }).positions[0]!.id).toBe(quiet.id);
  });

  it('keeps a set in the order it is given and lets a save be in many sets', () => {
    const db = freshDb();
    const a = createSavedPosition(db, { fen: FEN, title: 'A' });
    const b = createSavedPosition(db, { fen: FEN, title: 'B' });
    const lesson = createSet(db, { name: 'Lesson: Greek gift' });
    const friends = createSet(db, { name: 'To show Dani' });
    addToSet(db, lesson, [a.id, b.id]);
    addToSet(db, friends, [a.id]);
    reorderSet(db, lesson, [b.id, a.id]);
    expect(listSavedPositions(db, { setId: lesson }).positions.map((p) => p.title)).toEqual(['B', 'A']);
    expect(listSavedPositions(db, { setId: friends }).total).toBe(1);
  });

  it('moves deletes to the trash, restores them, and purges after 30 days', () => {
    const db = freshDb();
    const saved = createSavedPosition(db, { fen: FEN, title: 'Gone soon' });
    softDelete(db, 'saved_position', [saved.id]);
    expect(listSavedPositions(db).total).toBe(0);
    expect(listTrash(db).map((t) => t.label)).toEqual(['Gone soon']);
    restore(db, 'saved_position', saved.id);
    expect(listSavedPositions(db).total).toBe(1);
    softDelete(db, 'saved_position', [saved.id]);
    expect(purgeTrash(db, 30)).toBe(0);
    expect(purgeTrash(db, -1)).toBe(1);
    expect(listTrash(db)).toEqual([]);
  });
});

describe('the library API', () => {
  it('imports pasted PGN and answers position searches', async () => {
    const app = buildApp(freshDb());
    const imported = await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: TWO_GAMES } });
    expect(imported.json()).toMatchObject({ imported: 2 });
    const search = await app.inject({ method: 'GET', url: `/api/positions/games?fen=${encodeURIComponent(FOUR_KNIGHTS_ISH)}` });
    expect(search.json().total).toBe(2);
    const bad = await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: 'nonsense', title: 'x' } });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe('counts in side lists', () => {
  it('counts the positions in a set and the games in a collection', async () => {
    const { listCollections, listSets } = await import('../db/library.ts');
    const db = freshDb();
    const set = createSet(db, { name: 'S' });
    createSavedPosition(db, { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Back rank', setIds: [set] });
    createSavedPosition(db, { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Again', setIds: [set] });
    expect(listSets(db)[0]!.positions).toBe(2);
    const collectionId = createCollection(db, { name: 'C' });
    importGames(db, TWO_GAMES, { source: 'file', collectionId });
    expect(listCollections(db)[0]!.games).toBe(2);
  });
});
