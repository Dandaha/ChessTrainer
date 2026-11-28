import { describe, expect, it } from 'vitest';
import { type Game, type MoveNode, addMove, getHeader, mainlineFrom } from '../tree.ts';
import { PgnParseError, parseGame, parsePgn, writePgn } from '../pgn.ts';

/** The tree without node ids, for comparing two parses. */
function shape(node: MoveNode): unknown {
  return {
    san: node.san,
    ply: node.ply,
    nags: node.nags,
    comments: node.comments,
    startingComments: node.startingComments,
    arrows: node.arrows,
    highlights: node.highlights,
    children: node.children.map(shape),
  };
}

function sans(game: Game): string[] {
  return mainlineFrom(game.root).slice(1).map((n) => n.san);
}

function movetextOf(pgn: string): string {
  return pgn.split('\n\n')[1]!.trim();
}

const RICH = `[Event "Casual game"]
[Site "?"]
[Date "2026.11.20"]
[Round "-"]
[White "Dave"]
[Black "Friend \\"The Wall\\""]
[Result "0-1"]
[ECO "C50"]
[Annotator "Me"]

{ The Blackburne Shilling trap. } 1. e4 { [%clk 0:05:00] } e5 2. Nf3 Nc6
(2... d6 { Philidor } 3. d4 (3. Bc4 $5) 3... exd4) (2... Nf6 { [%cal Gf6e4] Petrov })
3. Bc4! { [%csl Gf7][%cal Gc4f7,Rd8h4] Eyeing f7. } Nd4?! 4. Nxe5 $1 Qg5 (4... Qe7 $14)
5. Nxf7?? (5. Bxf7+ $1 Ke7 6. Bxg8 $16) ( { Also good: } 5. O-O) 5... Qxg2 6. Rf1
Qxe4+ 7. Be2 Nf3# 0-1
`;

describe('parsePgn', () => {
  it('reads tags, the main line and the result', () => {
    const game = parseGame(RICH);
    expect(getHeader(game, 'White')).toBe('Dave');
    expect(getHeader(game, 'Black')).toBe('Friend "The Wall"');
    expect(game.result).toBe('0-1');
    expect(sans(game)).toEqual([
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nd4', 'Nxe5', 'Qg5', 'Nxf7', 'Qxg2', 'Rf1', 'Qxe4+', 'Be2', 'Nf3#',
    ]);
  });

  it('reads variations, nested variations and comments in the right places', () => {
    const game = parseGame(RICH);
    expect(game.root.comments).toEqual(['The Blackburne Shilling trap.']);
    const [e4] = game.root.children;
    expect(e4!.comments).toEqual(['[%clk 0:05:00]']);
    const nf3 = e4!.children[0]!.children[0]!;
    expect(nf3.children.map((n) => n.san)).toEqual(['Nc6', 'd6', 'Nf6']);
    const d6 = nf3.children[1]!;
    expect(d6.comments).toEqual(['Philidor']);
    expect(d6.children.map((n) => n.san)).toEqual(['d4', 'Bc4']);
    expect(d6.children[1]!.nags).toEqual([5]);
    const petrov = nf3.children[2]!;
    expect(petrov.comments).toEqual(['Petrov']);
    expect(petrov.arrows).toEqual([{ from: 'f6', to: 'e4', color: 'green' }]);
  });

  it('reads suffixes, NAGs, arrows and highlights', () => {
    const game = parseGame(RICH);
    const bc4 = mainlineFrom(game.root)[5]!;
    expect(bc4.san).toBe('Bc4');
    expect(bc4.nags).toEqual([1]);
    expect(bc4.comments).toEqual(['Eyeing f7.']);
    expect(bc4.highlights).toEqual([{ square: 'f7', color: 'green' }]);
    expect(bc4.arrows).toEqual([
      { from: 'c4', to: 'f7', color: 'green' },
      { from: 'd8', to: 'h4', color: 'red' },
    ]);
    const nd4 = bc4.children[0]!;
    expect(nd4.nags).toEqual([6]);
    const nxf7 = mainlineFrom(game.root)[9]!;
    expect(nxf7.nags).toEqual([4]);
  });

  it('keeps a comment that opens a variation before its first move', () => {
    const game = parseGame(RICH);
    const qg5 = mainlineFrom(game.root)[8]!;
    const castles = qg5.children.find((n) => n.san === 'O-O')!;
    expect(castles.startingComments).toEqual(['Also good:']);
  });

  it('starts from a FEN tag with Black to move', () => {
    const game = parseGame(`[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"]
[SetUp "1"]

1... c5 2. Nf3 (2. c3) 2... d6 *`);
    expect(sans(game)).toEqual(['c5', 'Nf3', 'd6']);
    expect(movetextOf(writePgn(game))).toBe('1... c5 2. Nf3 (2. c3) 2... d6 *');
  });

  it('accepts the loose PGN people paste', () => {
    const text =
      '\uFEFF1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.0-0 Be7 ; a line comment\r\n% an escape line\r\n5.d4 exd4 6.e5 Ne4 7.Re1 d5 8.exd6 e.p.\r\n';
    const game = parseGame(text);
    expect(sans(game)).toEqual([
      'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'O-O', 'Be7', 'd4', 'exd4', 'e5', 'Ne4', 'Re1', 'd5', 'exd6',
    ]);
    expect(mainlineFrom(game.root)[8]!.comments).toEqual(['a line comment']);
    expect(game.result).toBe('*');
  });

  it('takes the result from the Result tag when the movetext has none', () => {
    expect(parseGame('[Result "1/2-1/2"]\n\n1. e4 e5').result).toBe('1/2-1/2');
  });

  it('merges a variation that repeats the main move', () => {
    const game = parseGame('1. e4 (1. e4 c5) 1... e5 *');
    const e4 = game.root.children;
    expect(e4).toHaveLength(1);
    expect(e4[0]!.children.map((n) => n.san)).toEqual(['e5', 'c5']);
  });

  it('reads several games and reports a broken one by line, keeping the rest', () => {
    const text = `[Event "A"]

1. e4 e5 *

[Event "B"]

1. e4 e5
2. Ke3 *

[Event "C"]

1. d4 *
`;
    const { games, errors } = parsePgn(text);
    expect(games.map((g) => getHeader(g, 'Event'))).toEqual(['A', 'C']);
    expect(errors).toEqual([{ gameIndex: 1, line: 8, message: '2. Ke3 is not a legal move here' }]);
  });

  it('recovers from a comment that is never closed', () => {
    const { games, errors } = parsePgn('[Event "A"]\n\n1. e4 { oops\n\n[Event "B"]\n\n1. d4 *\n');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/never closed/);
    expect(games.map((g) => getHeader(g, 'Event'))).toEqual(['B']);
  });

  it('explains what is wrong with a broken game', () => {
    expect(() => parseGame('1. e4 e5)')).toThrow(/never opened/);
    expect(() => parseGame('(1. e4)')).toThrow(/must follow a move/);
    expect(() => parseGame('[FEN "nonsense"]\n\n*')).toThrow(/FEN tag/);
    expect(() => parseGame('')).toThrow(/No game found/);
    expect(() => parseGame('1. e4 -- 2. d4')).toThrow(/Null moves/);
    expect(() => parseGame('hello world')).toThrow(PgnParseError);
  });
});

describe('writePgn', () => {
  it('writes the Seven Tag Roster first, then the other tags', () => {
    const pgn = writePgn(parseGame('[ECO "B20"]\n[White "A"]\n\n1. e4 c5 *'));
    expect(pgn.split('\n\n')[0]).toBe(
      [
        '[Event "?"]',
        '[Site "?"]',
        '[Date "????.??.??"]',
        '[Round "?"]',
        '[White "A"]',
        '[Black "?"]',
        '[Result "*"]',
        '[ECO "B20"]',
      ].join('\n'),
    );
  });

  it('numbers Black moves after comments and variations', () => {
    const game = parseGame('1. e4 { best by test } e5 (1... c5 { Sicilian } 2. Nf3) 2. Nf3 Nc6 *');
    expect(movetextOf(writePgn(game))).toBe(
      '1. e4 { best by test } 1... e5 (1... c5 { Sicilian } 2. Nf3) 2. Nf3 Nc6 *',
    );
  });

  it('writes the rich game back without losing anything', () => {
    const first = parseGame(RICH);
    const written = writePgn(first);
    const second = parseGame(written);
    expect(shape(second.root)).toEqual(shape(first.root));
    expect(second.headers).toEqual(first.headers);
    expect(second.result).toBe(first.result);
    // Writing is stable: a second round trip gives the same text.
    expect(writePgn(second)).toBe(written);
  });

  it('writes drawings into the comment and keeps other commands', () => {
    const movetext = movetextOf(writePgn(parseGame(RICH), { lineLength: 0 }));
    expect(movetext).toContain('3. Bc4! { [%csl Gf7] [%cal Gc4f7,Rd8h4] Eyeing f7. } 3... Nd4?!');
    expect(movetext).toContain('1. e4 { [%clk 0:05:00] } 1... e5');
    expect(movetext).toContain('(2... Nf6 { [%cal Gf6e4] Petrov })');
    expect(movetext).toContain('({ Also good: } 5. O-O)');
    expect(movetext).toContain('(3. Bc4!?)');
    expect(movetext).toContain('4. Nxe5! Qg5 (4... Qe7 $14)');
  });

  it('wraps movetext at 80 characters, or not at all', () => {
    const pgn = writePgn(parseGame(RICH));
    for (const line of movetextOf(pgn).split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(movetextOf(writePgn(parseGame(RICH), { lineLength: 0 })).includes('\n')).toBe(false);
  });

  it('escapes quotes and backslashes in tag values', () => {
    const game = parseGame('[Event "A \\"quoted\\" path C:\\\\games"]\n\n*');
    expect(getHeader(game, 'Event')).toBe('A "quoted" path C:\\games');
    expect(writePgn(game)).toContain('[Event "A \\"quoted\\" path C:\\\\games"]');
  });

  it('keeps a sideline added after import (the phase 1 round trip)', () => {
    const game = parseGame('[White "Me"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *');
    const nc6 = mainlineFrom(game.root)[4]!;
    expect(nc6.san).toBe('Nc6');
    const bc4 = addMove(nc6, 'Bc4');
    addMove(bc4, 'Bc5');
    const exported = writePgn(game);
    expect(movetextOf(exported)).toBe('1. e4 e5 2. Nf3 Nc6 3. Bb5 (3. Bc4 Bc5) 3... a6 *');
    const reimported = parseGame(exported);
    expect(shape(reimported.root)).toEqual(shape(game.root));
  });
});

describe('a broken game in a file', () => {
  it('costs only that game: a broken tag does not leave the rest of its header behind as a game', () => {
    const text = [
      '[Event "One"]\n[White "Broken tag White]\n[Black "B"]\n\n1. e4 e5 *',
      '[Event "Two"]\n[White "C"]\n[Black "D"]\n\n1. d4 d5 *',
    ].join('\n\n');
    const { games, errors } = parsePgn(text);
    expect(errors).toHaveLength(1);
    expect(games.map((g) => g.headers.find((h) => h.name === 'Event')?.value)).toEqual(['Two']);
  });
});
