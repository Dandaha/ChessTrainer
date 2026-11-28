import { describe, expect, it } from 'vitest';
import { parseGame, writePgn } from '../pgn.ts';
import { normalizeFen, positionKey } from '../positionKey.ts';
import { type MoveNode } from '../tree.ts';
import {
  type RepEdge,
  checkGame,
  describeCheck,
  edgesFromGame,
  opponentPositions,
  lineLabel,
  pickReply,
  replyWeight,
  repertoireToGame,
  repertoireTree,
  unreachableEdges,
} from '../repertoire.ts';

/** Turns new edges into stored-looking edges, deduplicated by (from, move), as the database does. */
function store(pgn: string, color: 'white' | 'black'): RepEdge[] {
  const out = new Map<string, RepEdge>();
  for (const game of [parseGame(pgn)]) {
    for (const e of edgesFromGame(game, color)) {
      const fromKey = positionKey(e.fromFen);
      const id = `${fromKey}|${e.uci}`;
      if (out.has(id)) continue;
      const first = ![...out.values()].some((x) => x.fromKey === fromKey);
      out.set(id, {
        id,
        fromKey,
        toKey: positionKey(e.toFen),
        san: e.san,
        uci: e.uci,
        isMyMove: e.isMyMove,
        isMain: first,
        priority: e.priority ?? 'must',
        comment: e.comment,
        nags: e.nags,
      });
    }
  }
  return [...out.values()];
}

// A small White repertoire where 1.d4 Nf6 2.c4 e6 3.Nc3 and 1.c4 e6 2.d4 Nf6 3.Nc3 meet.
const WHITE = '1. d4 Nf6 (1... d5 2. c4) 2. c4 e6 3. Nc3 { Nimzo allowed } (3. Nf3) *';
const WHITE_TRANSPOSING = '1. c4 e6 2. d4 Nf6 3. Nc3 Bb4 *';

describe('the repertoire graph', () => {
  it('marks my moves and the opponent’s by colour', () => {
    const edges = store(WHITE, 'white');
    expect(edges.filter((e) => e.isMyMove).map((e) => e.san)).toEqual(['d4', 'c4', 'Nc3', 'Nf3', 'c4']);
    expect(edges.filter((e) => !e.isMyMove).map((e) => e.san)).toEqual(['Nf6', 'e6', 'd5']);
  });

  it('builds the explorer tree and shows a transposition once', () => {
    const edges = [...store(WHITE, 'white'), ...store(WHITE_TRANSPOSING, 'white').filter((e) => e.san !== 'Bb4' || true)];
    const unique = [...new Map(edges.map((e) => [e.id, e])).values()];
    const tree = repertoireTree(unique);
    expect(tree.map((n) => n.edge.san)).toEqual(['d4', 'c4']);
    // 1.c4 e6 2.d4 Nf6 reaches the position of 1.d4 Nf6 2.c4 e6: a transposition, not expanded again.
    const viaC4 = tree[1]!.children[0]!.children[0]!.children[0]!;
    expect(viaC4.edge.san).toBe('Nf6');
    expect(viaC4.transposition).toBe(true);
    expect(viaC4.children).toEqual([]);
    // The Bb4 reply hangs on the shared position, so it shows under 1.d4 too.
    const nc3 = tree[0]!.children[0]!.children[0]!.children[0]!.children[0]!;
    expect(nc3.edge.san).toBe('Nc3');
    expect(nc3.children.map((n) => n.edge.san)).toEqual(['Bb4']);
  });

  it('exports to PGN with variations and comments, and reads back the same edges', () => {
    const edges = store(WHITE, 'white');
    const pgn = writePgn(repertoireToGame(edges), { lineLength: 0 });
    expect(pgn).toContain('1. d4 Nf6 (1... d5 2. c4) 2. c4 e6 3. Nc3 { Nimzo allowed } (3. Nf3) *');
    const again = store(pgn, 'white');
    expect(again.map((e) => [e.fromKey, e.uci, e.isMyMove])).toEqual(edges.map((e) => [e.fromKey, e.uci, e.isMyMove]));
  });

  it('finds where a game left the preparation, mine or the opponent’s', () => {
    const edges = store(WHITE, 'white');
    const mine = checkGame(parseGame('1. d4 Nf6 2. Nf3 e6 *'), edges, 'white');
    expect(mine).toEqual({ kind: 'i-left', ply: 3, played: 'Nf3', prepared: ['c4'] });
    expect(describeCheck(mine)).toBe('You left your preparation on move 2 with Nf3; your line is c4.');

    const theirs = checkGame(parseGame('1. d4 g6 2. c4 *'), edges, 'white');
    expect(theirs).toEqual({ kind: 'opponent-left', ply: 2, played: 'g6', prepared: ['Nf6', 'd5'] });
    expect(describeCheck(theirs)).toBe('Your opponent left your preparation on move 1 with ...g6; you prepared ...Nf6, ...d5.');

    expect(checkGame(parseGame('1. d4 Nf6 2. c4 e6 3. Nc3 Bb4 4. Qc2 *'), edges, 'white')).toEqual({ kind: 'followed', plies: 5 });
  });

  it('describes leaving the preparation with Black the way the spec says', () => {
    const edges = store('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Bb7 *', 'black');
    const result = checkGame(parseGame('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nd7 *'), edges, 'black');
    expect(describeCheck(result)).toBe('You left your preparation on move 9 with ...Nd7; your line is ...Bb7.');
  });

  it('lists the positions where the opponent is to move, for the gap finder', () => {
    const edges = store(WHITE, 'white');
    const positions = opponentPositions(edges, 'white');
    expect(positions.map((p) => p.ply)).toEqual([1, 3, 3, 5, 5]);
  });

  it('finds the moves cut off when a move higher up is deleted', () => {
    const edges = store(WHITE, 'white');
    const nf6 = edges.find((e) => e.san === 'Nf6')!;
    const cut = unreachableEdges(edges.filter((e) => e !== nf6));
    expect(cut.map((e) => e.san)).toEqual(['c4', 'e6', 'Nc3', 'Nf3']);
  });
});

describe('the repertoire tree', () => {
  it('gives every node the FEN the moves reach, move counters included, without playing them', () => {
    // Pawn moves and captures reset the 50-move clock; piece moves and castling count it up.
    const pgn = '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O Nxe4 5. Re1) 4. Bxc6 dxc6 5. O-O f6 6. d4 exd4 7. Nxd4 c5 8. Nb3 Qxd1 9. Rxd1 *';
    const game = parseGame(pgn);
    const expected = new Map<string, string>();
    const walk = (node: MoveNode) => {
      expected.set(positionKey(node.fen), normalizeFen(node.fen));
      node.children.forEach(walk);
    };
    walk(game.root);
    const fens: string[] = [];
    const collect = (nodes: ReturnType<typeof repertoireTree>) =>
      nodes.forEach((n) => {
        fens.push(n.fen);
        collect(n.children);
      });
    collect(repertoireTree(store(pgn, 'white')));
    expect(fens.length).toBe(expected.size - 1);
    for (const fen of fens) expect(fen).toBe(expected.get(positionKey(fen)));
  });
});

describe('a repertoire through PGN and back', () => {
  it('keeps "nice to know" and comments, without the transposition note piling up', () => {
    const edges = store(`${WHITE}`, 'white').map((e) => (e.san === 'Nf3' ? { ...e, priority: 'nice' as const } : e));
    // A transposition in the tree, so the export writes its note.
    const both = [...edges, ...store(WHITE_TRANSPOSING, 'white').filter((t) => !edges.some((e) => e.id === t.id))];
    let round = both;
    for (let i = 0; i < 3; i += 1) round = store(writePgn(repertoireToGame(round)), 'white');
    expect(round.find((e) => e.san === 'Nf3')?.priority).toBe('nice');
    expect(round.find((e) => e.san === 'Nc3' && e.comment)?.comment).toBe('Nimzo allowed');
    expect(round.some((e) => e.comment?.includes('Transposes'))).toBe(false);
    expect(round).toHaveLength(both.length);
  });

  it('takes comments before a move, the opening comment and arrows into the move it belongs to', () => {
    const edges = store('{ My Sicilian } 1. e4 c5 ({ Not this: } 1... e5 { [%cal Gg1f3] }) 2. Nf3 *', 'black');
    expect(edges.find((e) => e.san === 'e4')?.comment).toBe('My Sicilian');
    expect(edges.find((e) => e.san === 'e5')?.comment).toBe('Not this: [%cal Gg1f3]');
  });
});

describe('replies in a line drill', () => {
  const reply = (san: string, isMain: boolean, priority: 'must' | 'nice') => ({ san, isMain, priority });

  it('weighs must-know replies above nice-to-know ones, whichever is listed first', () => {
    expect(replyWeight(reply('e5', true, 'must'))).toBe(3);
    expect(replyWeight(reply('c5', false, 'must'))).toBe(3);
    expect(replyWeight(reply('b6', false, 'nice'))).toBe(1);
  });

  it('picks in proportion to the weights', () => {
    const replies = [reply('e5', true, 'must'), reply('c5', false, 'must'), reply('b6', false, 'nice')];
    const counts = new Map<string, number>();
    for (let i = 0; i < 1400; i += 1) {
      const pick = pickReply(replies, () => (i + 0.5) / 1400)!;
      counts.set(pick.san, (counts.get(pick.san) ?? 0) + 1);
    }
    expect(counts.get('e5')).toBe(600);
    expect(counts.get('c5')).toBe(600);
    expect(counts.get('b6')).toBe(200);
    expect(pickReply([])).toBeUndefined();
  });
});

describe('lineLabel', () => {
  it('numbers White moves, and a first move by Black', () => {
    expect(lineLabel([{ ply: 1, san: 'e4' }, { ply: 2, san: 'e5' }, { ply: 3, san: 'Nf3' }])).toBe('1.e4 e5 2.Nf3');
    expect(lineLabel([{ ply: 6, san: 'Nf6' }, { ply: 7, san: 'Bg5' }])).toBe('3...Nf6 4.Bg5');
    expect(lineLabel([])).toBe('');
  });
});
