import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { deriveMissing, findDuplicates, importGames, listGames } from '../db/games.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const NAJDORF = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5';

describe('openings for games without one', () => {
  it('names the opening from the moves when the game has no ECO tag, and keeps tags it has', () => {
    const db = freshDb();
    importGames(
      db,
      `[White "Untagged"]\n\n${NAJDORF} *\n\n[White "Tagged"]\n[ECO "B92"]\n[Opening "My own name"]\n\n${NAJDORF} *\n\n[White "EcoOnly"]\n[ECO "B92"]\n\n${NAJDORF} *\n`,
      { source: 'file' },
    );
    const byWhite = Object.fromEntries(listGames(db).games.map((g) => [g.white, g]));
    expect(byWhite.Untagged).toMatchObject({ eco: 'B92', openingName: expect.stringContaining('Najdorf') });
    expect(byWhite.Tagged).toMatchObject({ eco: 'B92', openingName: 'My own name' });
    expect(byWhite.EcoOnly).toMatchObject({ eco: 'B92', openingName: expect.stringContaining('Najdorf') });
    expect(listGames(db, { opening: 'najdorf' }).total).toBe(2); // the third keeps its own name
  });
});

describe('duplicates by content', () => {
  it('finds the same game with different notes and tags, keeping the copy with the most in it', () => {
    const db = freshDb();
    importGames(db, `[White "Anna"]\n[Black "Bob"]\n[Date "2025.03.01"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n`, { source: 'file' });
    importGames(
      db,
      `[Event "Club"]\n[White "anna"]\n[Black "Bob"]\n[Date "2025.03.??"]\n[Result "1-0"]\n\n1. e4 { the best } e5 2. Nf3 1-0\n`,
      { source: 'lichess' },
    );
    // Same players and moves, another result: a different game.
    importGames(db, `[White "Anna"]\n[Black "Bob"]\n[Date "2025.03.01"]\n[Result "1/2-1/2"]\n\n1. e4 e5 2. Nf3 1/2-1/2\n`, { source: 'file' });
    const { groups, extraCopies } = findDuplicates(db);
    expect(extraCopies).toBe(1);
    expect(groups[0]!.keep.event).toBe('Club');
    expect(groups[0]!.copies.map((g) => g.event)).toEqual([null]);
  });

  it('fills in games from an older version before looking', () => {
    const db = freshDb();
    const insert = db.$client.prepare("insert into games (id, pgn, white, source, created_at, updated_at) values (?, ?, ?, 'file', '2026-01-01', '2026-01-01')");
    for (let i = 0; i < 2; i += 1) insert.run(randomUUID(), `[White "Old"]\n\n${NAJDORF} *\n`, 'Old');
    insert.run(randomUUID(), 'not a game at all (', 'Broken');
    expect(deriveMissing(db, 10)).toBe(3);
    expect(deriveMissing(db, 10)).toBe(0);
    expect(listGames(db, { player: 'Old' }).games[0]).toMatchObject({ eco: 'B92' });
    expect(findDuplicates(db).extraCopies).toBe(1);
  });
});
