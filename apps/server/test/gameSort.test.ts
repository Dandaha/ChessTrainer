import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { importGames, listGames } from '../db/games.ts';
import { createCollection } from '../db/library.ts';

/** The game list sorts by any column, empty values last, and games of one day by their time. */

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const game = (tags: Record<string, string>) =>
  `${Object.entries(tags)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n')}\n\n1. e4 e5 *\n`;

const GAMES = [
  game({ White: 'carla', Black: 'X', Date: '2026.03.01', UTCTime: '19:06:00', WhiteElo: '1500', Result: '1-0' }),
  game({ White: 'Anna', Black: 'Y', Date: '2026.03.01', UTCTime: '19:42:00', Result: '0-1' }),
  game({ White: 'bob', Black: 'Z', Date: '2026.02.10', WhiteElo: '2100', Result: '1/2-1/2' }),
].join('\n');

describe('sorting the game list', () => {
  it('puts the newest first by default, ordering one day by its time', () => {
    const db = freshDb();
    importGames(db, GAMES, { source: 'file' });
    expect(listGames(db).games.map((g) => g.white)).toEqual(['Anna', 'carla', 'bob']);
    expect(listGames(db, { sort: 'date', dir: 'asc' }).games.map((g) => g.white)).toEqual(['bob', 'carla', 'Anna']);
  });

  it('sorts by player regardless of case, and by rating with unrated games last either way', () => {
    const db = freshDb();
    importGames(db, GAMES, { source: 'file' });
    expect(listGames(db, { sort: 'white', dir: 'asc' }).games.map((g) => g.white)).toEqual(['Anna', 'bob', 'carla']);
    expect(listGames(db, { sort: 'whiteElo', dir: 'desc' }).games.map((g) => g.white)).toEqual(['bob', 'carla', 'Anna']);
    expect(listGames(db, { sort: 'whiteElo', dir: 'asc' }).games.map((g) => g.white)).toEqual(['carla', 'bob', 'Anna']);
  });

  it('keeps a collection in its own order until a column is chosen', () => {
    const db = freshDb();
    const collectionId = createCollection(db, { name: 'Mine' });
    importGames(db, GAMES, { source: 'file', collectionId });
    expect(listGames(db, { collectionId }).games.map((g) => g.white)).toEqual(['carla', 'Anna', 'bob']);
    expect(listGames(db, { collectionId, sort: 'white', dir: 'desc' }).games.map((g) => g.white)).toEqual(['carla', 'bob', 'Anna']);
  });

  it('fills in the time for games imported before it was kept', () => {
    const db = freshDb();
    importGames(db, GAMES, { source: 'file' });
    db.$client.exec('update games set time = null');
    // What migration 0007 does for games already in the library.
    db.$client.exec(`update games set time = substr(pgn, instr(pgn, '[UTCTime "') + 10, 8) where instr(pgn, '[UTCTime "') > 0`);
    expect(listGames(db).games.map((g) => g.white)).toEqual(['Anna', 'carla', 'bob']);
  });
});
