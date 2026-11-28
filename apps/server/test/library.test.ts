import { describe, expect, it, vi } from 'vitest';
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
  removeGamesFromCollection,
  reorderSet,
  restore,
  restoreGamesToCollection,
  savesOfPosition,
  softDelete,
  updateCollection,
  updateSavedPosition,
  updateSet,
} from '../db/library.ts';
import { buildApp } from '../src/app.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const FEN_START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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
    const report = importGames(db, TWO_GAMES, { source: 'lichess', myNames: ['Dave'] });
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

  it('keeps different games that share a website address in their Site tag', () => {
    const db = freshDb();
    const game = (white: string, moves: string) => `[Site "https://www.chessgames.com"]\n[White "${white}"]\n[Black "X"]\n\n${moves} *\n`;
    const pgn = [game('A', '1. e4 e5'), game('B', '1. d4 d5'), game('C', '1. c4 c5')].join('\n');
    expect(importGames(db, pgn, { source: 'file' })).toMatchObject({ imported: 3, duplicates: 0 });
    // A Chess.com game is still recognised by its Link the second time.
    const chesscom = '[Site "Chess.com"]\n[Link "https://www.chess.com/game/live/123456789"]\n[White "A"]\n[Black "B"]\n\n1. e4 *\n';
    importGames(db, chesscom, { source: 'chesscom' });
    expect(importGames(db, chesscom.replace('1. e4 *', '1. e4 e5 *'), { source: 'chesscom' }).duplicates).toBe(1);
  });

  it('searches literally and without regard to case in any alphabet', () => {
    const db = freshDb();
    const game = (white: string, black: string, moves: string) => `[White "${white}"]\n[Black "${black}"]\n\n${moves} *\n`;
    importGames(db, [game('tyler_920', 'Каспаров', '1. e4 e5'), game('tylerX920', 'Müller', '1. d4 d5'), game('A 50% chance', 'B', '1. c4 c5')].join('\n'), {
      source: 'file',
    });
    expect(listGames(db, { q: 'tyler_920' }).games.map((g) => g.white)).toEqual(['tyler_920']);
    expect(listGames(db, { player: 'каспаров' }).total).toBe(1);
    expect(listGames(db, { player: 'MÜLLER' }).total).toBe(1);
    // Accents are ignored too: "muller" finds "Müller".
    expect(listGames(db, { player: 'muller' }).total).toBe(1);
    expect(listGames(db, { q: '50%' }).total).toBe(1);
    expect(listGames(db, { q: '%' }).total).toBe(1);
    createSavedPosition(db, { fen: FEN_START, title: 'pawn_storm 50% idea' });
    expect(listSavedPositions(db, { q: 'PAWN_STORM' }).total).toBe(1);
    expect(listSavedPositions(db, { q: 'pawnXstorm' }).total).toBe(0);
  });

  it('leaves variants out and keeps games from a set-up position', () => {
    const db = freshDb();
    const pgn = [
      '[White "A"]\n[Black "B"]\n[Variant "Three-check"]\n\n1. e4 e5 *',
      '[White "C"]\n[Black "D"]\n[Variant "Standard"]\n\n1. d4 d5 *',
      '[White "E"]\n[Black "F"]\n[Variant "From Position"]\n[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. e4 *',
    ].join('\n\n');
    expect(importGames(db, pgn, { source: 'file' })).toMatchObject({ imported: 2, variants: 1, errors: [] });
  });

  it('imports somebody else’s games without making them mine', async () => {
    const db = freshDb();
    const app = buildApp(db);
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      return new Response(TWO_GAMES, { status: 200 });
    });
    try {
      await app.inject({ method: 'PUT', url: '/api/settings', payload: { lichessUsername: 'dave' } });
      await app.inject({ method: 'POST', url: '/api/games/import/lichess', payload: { username: 'Friend', max: 5, mine: false } });
      expect(new URL(urls[0]!).searchParams.get('perfType')).toBe('ultraBullet,bullet,blitz,rapid,classical,correspondence');
      expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().lichessUsername).toBe('dave');
      // My colour follows my own name (dave), not the imported one (Friend, Black in the first game).
      const colours = listGames(db).games.map((g) => [g.white, g.black, g.myColor]);
      expect(colours).toEqual(
        expect.arrayContaining([
          ['dave', 'Friend', 'white'],
          ['Other', 'Dave', 'black'],
        ]),
      );

      await app.inject({ method: 'POST', url: '/api/games/import/lichess', payload: { username: 'Friend', max: 5, mine: true } });
      expect((await app.inject({ method: 'GET', url: '/api/settings' })).json().lichessUsername).toBe('Friend');
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(listGames(db, { fen: '8/8/8/8/8/k7/8/K7 w - - 0 1' }).total).toBe(0);
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

  it('puts games taken out of a collection back where they were', () => {
    const db = freshDb();
    const collectionId = createCollection(db, { name: 'Selected classics' });
    importGames(db, TWO_GAMES, { source: 'file', collectionId });
    const order = () => listGames(db, { collectionId }).games.map((g) => g.event);
    const club = listGames(db, { collectionId }).games[0]!;
    const removed = removeGamesFromCollection(db, collectionId, [club.id]);
    expect(order()).toEqual(['Blitz']);
    restoreGamesToCollection(db, collectionId, removed);
    expect(order()).toEqual(['Club', 'Blitz']);
    expect(removeGamesFromCollection(db, collectionId, [])).toEqual([]);
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

  it('reorders the saves shown by a filter among their own places, leaving the rest of the set alone', () => {
    const db = freshDb();
    const set = createSet(db, { name: 'Endings' });
    const titles = ['One', 'Lucena', 'Two', 'Philidor', 'Three'];
    const saves = titles.map((title) => createSavedPosition(db, { fen: FEN, title, tags: title.length > 5 ? ['endgame'] : [] }));
    addToSet(db, set, saves.map((s) => s.id));
    // Filtered to #endgame the list shows Lucena then Philidor; Philidor is moved up.
    const [lucena, philidor] = [saves[1]!, saves[3]!];
    reorderSet(db, set, [philidor.id, lucena.id]);
    expect(listSavedPositions(db, { setId: set }).positions.map((p) => p.title)).toEqual(['One', 'Philidor', 'Two', 'Lucena', 'Three']);
  });

  it('numbers a filtered set by the places in the whole set', () => {
    const db = freshDb();
    const set = createSet(db, { name: 'Endings' });
    const titles = ['One', 'Lucena', 'Two', 'Philidor', 'Three'];
    const saves = titles.map((title) => createSavedPosition(db, { fen: FEN, title, tags: title.length > 5 ? ['endgame'] : [] }));
    addToSet(db, set, saves.map((s) => s.id));
    const places = (f: { tag?: string }) => listSavedPositions(db, { setId: set, ...f }).positions.map((p) => [p.title, p.setPlace]);
    expect(places({ tag: 'endgame' })).toEqual([
      ['Lucena', 2],
      ['Philidor', 4],
    ]);
    // A save in the trash holds no place.
    softDelete(db, 'saved_position', [saves[0]!.id]);
    expect(places({ tag: 'endgame' })).toEqual([
      ['Lucena', 1],
      ['Philidor', 3],
    ]);
    expect(places({}).map(([, place]) => place)).toEqual([1, 2, 3, 4]);
    expect(listSavedPositions(db).positions[0]!.setPlace).toBeUndefined();
  });

  it('refuses a set or collection name already in use, whatever its case or accents', () => {
    const db = freshDb();
    const endings = createSet(db, { name: 'Endings' });
    expect(() => createSet(db, { name: '  endings ' })).toThrow('There is already a set called “Endings”.');
    expect(() => createSet(db, { name: '   ' })).toThrow('A set needs a name.');
    createSet(db, { name: 'Café tactics' });
    expect(() => createSet(db, { name: 'cafe  TACTICS' })).toThrow('“Café tactics”');
    const other = createSet(db, { name: 'Openings' });
    expect(() => updateSet(db, other, { name: 'ENDINGS' })).toThrow('already a set called “Endings”');
    // A set may change the case of its own name, and a description alone is not a rename.
    updateSet(db, endings, { name: 'ENDINGS' });
    updateSet(db, other, { description: 'For Sunday' });
    // A name in the trash is free again; a set and a collection may share one.
    softDelete(db, 'position_set', [endings]);
    createSet(db, { name: 'Endings' });
    const classics = createCollection(db, { name: 'Endings' });
    expect(() => createCollection(db, { name: 'endings' })).toThrow('There is already a collection called “Endings”.');
    updateCollection(db, classics, { name: 'Endgames' });
    expect(() => createCollection(db, { name: 'Endgames' })).toThrow('already a collection');
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

  it('answers a name already in use with 400 and the reason, and undoes a removal in place', async () => {
    const app = buildApp(freshDb());
    await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Lesson' } });
    const twice = await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'lesson' } });
    expect(twice.statusCode).toBe(400);
    expect(twice.json().error).toBe('There is already a set called “Lesson”.');

    const { id } = (await app.inject({ method: 'POST', url: '/api/collections', payload: { name: 'C' } })).json();
    await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: TWO_GAMES, collectionId: id } });
    const events = async () =>
      (await app.inject({ method: 'GET', url: `/api/games?collectionId=${id}` })).json().games.map((g: { event: string }) => g.event);
    const [first] = (await app.inject({ method: 'GET', url: `/api/games?collectionId=${id}` })).json().games;
    const removal = await app.inject({ method: 'POST', url: `/api/collections/${id}/games/remove`, payload: { gameIds: [first.id] } });
    expect(await events()).toEqual(['Blitz']);
    const back = await app.inject({ method: 'POST', url: `/api/collections/${id}/games/restore`, payload: { places: removal.json().removed } });
    expect(back.statusCode).toBe(200);
    expect(await events()).toEqual(['Club', 'Blitz']);
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
