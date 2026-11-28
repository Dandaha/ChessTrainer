import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { deleteCategory, listCategories, renameCategory } from '../db/categories.ts';
import { openDatabase, runMigrations } from '../db/client.ts';
import {
  conceptsAtPosition,
  conceptsFor,
  createConcept,
  drillPosition,
  getConcept,
  linkConcept,
  listConcepts,
  searchConcepts,
  unlinkConcept,
  updateConcept,
} from '../db/concepts.ts';
import { importGames } from '../db/games.ts';
import { createSavedPosition, listTrash, softDelete } from '../db/library.ts';
import { addLine, createRepertoire, getEdges } from '../db/repertoire.ts';
import { chessData } from '../src/toolData.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const LUCENA = '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1';

describe('the concepts library', () => {
  it('finds a concept by any of its names', () => {
    const db = freshDb();
    createConcept(db, { title: 'Lucena position', aliases: ['Building a bridge'], category: 'Endgame technique' });
    createConcept(db, { title: 'Minority attack', category: 'Strategic plans', bodyMd: 'b4-b5 against the c6 pawn' });
    expect(listConcepts(db, { q: 'bridge' }).map((c) => c.title)).toEqual(['Lucena position']);
    expect(listConcepts(db, { q: 'c6 pawn' }).map((c) => c.title)).toEqual(['Minority attack']);
    expect(listConcepts(db, { category: 'endgame technique' })).toHaveLength(1);
  });

  it('can be created with just a title and filled in later', () => {
    const db = freshDb();
    const c = createConcept(db, { title: 'Good knight vs bad bishop' });
    updateConcept(db, c.id, { keySigns: ['Pawns fixed on the bishop’s colour', ' ', 'An outpost for the knight'], tags: ['Middlegame'] });
    expect(getConcept(db, c.id)).toMatchObject({ keySigns: ['Pawns fixed on the bishop’s colour', 'An outpost for the knight'], tags: ['middlegame'] });
  });

  it('links both ways: the page lists its items, the items list the concept', () => {
    const db = freshDb();
    const lucena = createConcept(db, { title: 'Lucena position' });
    const philidor = createConcept(db, { title: 'Philidor position' });
    const saved = createSavedPosition(db, { fen: LUCENA, title: 'Classic Lucena' });
    const [gameId] = importGames(db, '[White "A"]\n\n1. e4 *', { source: 'file' }).gameIds;
    const rep = createRepertoire(db, { name: 'W', color: 'white' });
    addLine(db, rep, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4']);
    const [edge] = getEdges(db, rep);

    linkConcept(db, lucena.id, 'saved_position', { id: saved.id });
    linkConcept(db, lucena.id, 'game', { id: gameId });
    linkConcept(db, lucena.id, 'repertoire_move', { id: edge!.id });
    linkConcept(db, lucena.id, 'concept', { id: philidor.id });

    const page = getConcept(db, lucena.id)!;
    expect(page.savedPositions.map((s) => s.title)).toEqual(['Classic Lucena']);
    expect(page.games).toHaveLength(1);
    expect(page.repertoireMoves.map((m) => m.san)).toEqual(['e4']);
    expect(page.related.map((r) => r.title)).toEqual(['Philidor position']);
    // The other way round.
    expect(getConcept(db, philidor.id)!.related.map((r) => r.title)).toEqual(['Lucena position']);
    expect(conceptsFor(db, 'saved_position', saved.id).map((c) => c.title)).toEqual(['Lucena position']);
    expect(conceptsAtPosition(db, LUCENA.replace(' 0 1', ' 5 60')).map((c) => c.title)).toEqual(['Lucena position']);

    unlinkConcept(db, philidor.id, 'concept', lucena.id);
    expect(getConcept(db, lucena.id)!.related).toEqual([]);
  });

  it('links a position by FEN and drills it', () => {
    const db = freshDb();
    const c = createConcept(db, { title: 'Back rank mate' });
    expect(drillPosition(db, c.id)).toBeNull();
    linkConcept(db, c.id, 'position', { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' });
    expect(drillPosition(db, c.id)).toMatchObject({ fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Back rank mate' });
  });

  it('goes to the trash like everything else', () => {
    const db = freshDb();
    const c = createConcept(db, { title: 'Zwischenzug' });
    softDelete(db, 'concept', [c.id]);
    expect(listConcepts(db)).toEqual([]);
    expect(listTrash(db).map((t) => [t.kind, t.label])).toEqual([['concept', 'Zwischenzug']]);
  });

  it('answers the coach’s search with the best match first', async () => {
    const db = freshDb();
    createConcept(db, { title: 'Minority attack', aliases: ['Queenside minority attack'], bodyMd: 'In the Carlsbad structure, b4-b5.' });
    createConcept(db, { title: 'Carlsbad structure', bodyMd: 'Pawns on d4 c3 vs d5 c6.' });
    const found = searchConcepts(db, 'minority attack');
    expect(found[0]!.title).toBe('Minority attack');
    const viaTool = (await chessData(db).searchConcepts('carlsbad')) as { title: string }[];
    expect(viaTool.map((c) => c.title)).toEqual(expect.arrayContaining(['Carlsbad structure', 'Minority attack']));
  });
});

describe('concept categories', () => {
  const BUILT_IN = ['Pawn structures', 'Strategic plans', 'Tactical motifs', 'Endgame technique', 'Opening ideas', 'Practical play'];

  it('start as the six built-in ones, take new ones, and rename or remove them on every concept', () => {
    const db = freshDb();
    expect(listCategories(db, 'concept').map((c) => c.name)).toEqual(BUILT_IN);
    // A new name joins the list; the same name in other case is the one already there.
    createConcept(db, { title: 'Arabian mate', category: 'Checkmate patterns' });
    createConcept(db, { title: 'Smothered mate', category: 'checkmate PATTERNS' });
    const mates = listCategories(db, 'concept').find((c) => c.name === 'Checkmate patterns')!;
    expect(mates.count).toBe(2);
    expect(listConcepts(db, { category: 'Checkmate patterns' }).map((c) => c.category)).toEqual(['Checkmate patterns', 'Checkmate patterns']);

    renameCategory(db, 'concept', mates.id, 'Mating patterns');
    expect(listConcepts(db).map((c) => c.category)).toEqual(['Mating patterns', 'Mating patterns']);
    expect(() => renameCategory(db, 'concept', mates.id, 'tactical motifs')).toThrow('There is already a category called “Tactical motifs”.');

    expect(deleteCategory(db, 'concept', mates.id)).toEqual({ removed: true, uncategorized: 2 });
    expect(listConcepts(db).map((c) => c.category)).toEqual([null, null]);
    // Position categories are a list of their own.
    expect(listCategories(db, 'position').map((c) => c.name)).not.toContain('Mating patterns');
  });

  it('turn the keys concepts held before into the categories’ names when the app updates', () => {
    // The migrations up to the one before concept categories, a concept filed the old way, then the rest.
    const source = fileURLToPath(new URL('../db/migrations', import.meta.url));
    const folder = mkdtempSync(join(tmpdir(), 'migrations-'));
    try {
      cpSync(source, folder, { recursive: true });
      const journalPath = join(folder, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
      const at = journal.entries.findIndex((e) => e.tag.endsWith('_concept_categories'));
      journal.entries = journal.entries.slice(0, at);
      writeFileSync(journalPath, JSON.stringify(journal));
      const { db } = openDatabase(':memory:');
      migrate(db, { migrationsFolder: folder });
      const stamp = new Date().toISOString();
      db.$client
        .prepare('insert into concepts (id, title, aliases, category, key_signs, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)')
        .run('c1', 'Greek gift', '[]', 'tactical_motif', '[]', stamp, stamp);
      runMigrations(db);
      expect(listConcepts(db).map((c) => c.category)).toEqual(['Tactical motifs']);
      expect(listCategories(db, 'concept').find((c) => c.name === 'Tactical motifs')!.count).toBe(1);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

