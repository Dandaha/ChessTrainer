import { type MoveNode, START_FEN, createGame, gameEnd, isValidFen, playMove } from '@chess/chess-core';
import { describe, expect, it } from 'vitest';
import { listCategories } from '../db/categories.ts';
import { openDatabase, runMigrations } from '../db/client.ts';
import { createConcept, getConcept, listConcepts } from '../db/concepts.ts';
import { softDelete } from '../db/library.ts';
import { STARTER_CONCEPTS } from '../db/starterConcepts.ts';
import { addStarterConcepts, addStarterConceptsOnce, missingStarterConcepts } from '../db/starterLibrary.ts';

function freshDb() {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  return db;
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’‘]/g, "'").toLowerCase();
// A run of numbered moves in running text, as the page's markdown finds them (components/Markdown.tsx).
const MOVES = /\b\d+\.(?:\.\.)?\s*(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)/;

/** Plays a line of moves ("1. e4 e5 2. Nf3") from a FEN; throws on the first illegal one. */
function play(fen: string, moves: string): MoveNode[] {
  const path = [createGame(fen).root];
  for (const token of moves.split(/\s+/).map((t) => t.replace(/^\d+\.(\.\.)?/, '')).filter(Boolean)) {
    path.push(playMove(path.at(-1)!, token));
  }
  return path;
}

describe('the starter concepts', () => {
  it('have unique names, known categories and levels, signs, a write-up, and related concepts that exist', () => {
    const titles = new Set(STARTER_CONCEPTS.map((c) => fold(c.title)));
    expect(titles.size).toBe(STARTER_CONCEPTS.length);
    const names = STARTER_CONCEPTS.flatMap((c) => [c.title, ...(c.aliases ?? [])].map(fold));
    expect(new Set(names).size).toBe(names.length);
    const categories = new Set(STARTER_CONCEPTS.map((c) => c.category));
    expect([...categories].sort()).toEqual(
      ['Checkmate patterns', 'Endgame technique', 'Opening ideas', 'Pawn structures', 'Practical play', 'Strategic plans', 'Tactical motifs'].sort(),
    );
    for (const c of STARTER_CONCEPTS) {
      expect(['basic', 'intermediate', 'advanced'], c.title).toContain(c.level);
      expect(c.signs.length, c.title).toBeGreaterThan(0);
      expect(c.body.length, c.title).toBeGreaterThan(80);
      for (const r of c.related ?? []) {
        expect(titles.has(fold(r)), `${c.title} → ${r}`).toBe(true);
        expect(fold(r), c.title).not.toBe(fold(c.title));
      }
    }
    // Every level and category is well filled.
    for (const level of ['basic', 'intermediate', 'advanced']) expect(STARTER_CONCEPTS.filter((c) => c.level === level).length).toBeGreaterThan(20);
  });

  it('show only legal lines, from the board above them or the start, and the mates are mate', () => {
    let lines = 0;
    for (const c of STARTER_CONCEPTS) {
      let base = START_FEN;
      const blocks = c.body.split('```');
      blocks.forEach((block, i) => {
        if (i % 2 === 0) {
          // Running text: a FEN on its own line sets the board; numbered moves belong in line blocks.
          for (const text of block.split('\n')) {
            if (isValidFen(text.trim()) && text.includes('/')) base = text.trim();
            else expect(MOVES.test(text), `${c.title}: moves in the text: ${text}`).toBe(false);
          }
          return;
        }
        const moves = block.replace(/^line\n/, '').trim();
        const path = play(base, moves);
        lines += 1;
        if (moves.endsWith('#')) expect(gameEnd(path)?.kind, `${c.title}: ${moves}`).toBe('checkmate');
        if (moves.endsWith('+')) expect(path.at(-1)!.san.endsWith('+'), c.title).toBe(true);
      });
    }
    expect(lines).toBeGreaterThanOrEqual(12);
  });

  it('go into a library once, with categories, level tags and related links, never twice', () => {
    const db = freshDb();
    expect(addStarterConceptsOnce(db)).toBe(STARTER_CONCEPTS.length);
    expect(listConcepts(db)).toHaveLength(STARTER_CONCEPTS.length);
    expect(listCategories(db, 'concept').map((c) => c.name)).toContain('Checkmate patterns');
    const fork = listConcepts(db, { q: 'Fork' }).find((c) => c.title === 'Fork')!;
    expect(fork).toMatchObject({ category: 'Tactical motifs', tags: ['basic'] });
    const page = getConcept(db, fork.id)!;
    expect(page.keySigns.length).toBeGreaterThan(0);
    expect(page.related.map((r) => r.title).sort()).toEqual(['Decoy', 'Double attack', 'Loose pieces']);
    // A concept that lists Fork as related links back to it as well.
    expect(getConcept(db, listConcepts(db, { q: 'Loose pieces' })[0]!.id)!.related.map((r) => r.title)).toContain('Fork');

    // Not again at the next start, even after the person deletes one.
    softDelete(db, 'concept', [fork.id]);
    expect(addStarterConceptsOnce(db)).toBe(0);
    expect(listConcepts(db)).toHaveLength(STARTER_CONCEPTS.length - 1);
    // On request, the missing one comes back.
    expect(addStarterConcepts(db)).toBe(1);
  });

  it('leave the person’s own concepts alone, matching by title or another name', () => {
    const db = freshDb();
    const mine = createConcept(db, { title: 'knight FORK', bodyMd: 'My own notes', category: 'Tactics I know' });
    createConcept(db, { title: 'Zwischenzug' });
    addStarterConcepts(db);
    const forks = listConcepts(db).filter((c) => ['fork', 'knight fork'].includes(c.title.toLowerCase()));
    expect(forks.map((c) => c.id)).toEqual([mine.id]);
    expect(getConcept(db, mine.id)!.bodyMd).toBe('My own notes');
    expect(listConcepts(db).filter((c) => c.title === 'Zwischenzug')).toHaveLength(1);
    expect(listConcepts(db)).toHaveLength(STARTER_CONCEPTS.length);
  });
});

describe('missing starter concepts', () => {
  it('counts what a library lacks, by title or another name', () => {
    const db = freshDb();
    expect(missingStarterConcepts(db)).toBe(STARTER_CONCEPTS.length);
    addStarterConcepts(db);
    expect(missingStarterConcepts(db)).toBe(0);
    softDelete(db, 'concept', [listConcepts(db, { q: 'Fork' }).find((c) => c.title === 'Fork')!.id]);
    expect(missingStarterConcepts(db)).toBe(1);
  });
});
