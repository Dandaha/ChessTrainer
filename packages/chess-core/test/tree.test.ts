import { describe, expect, it } from 'vitest';
import { positionKey } from '../positionKey.ts';
import {
  IllegalMoveError,
  addMove,
  createGame,
  deleteNode,
  getHeader,
  isOnMainline,
  isWhiteMove,
  mainlineFrom,
  makeMainline,
  moveNumber,
  pathTo,
  promoteVariation,
  setComment,
  toggleNag,
} from '../tree.ts';

function line(...moves: string[]) {
  const game = createGame();
  let node = game.root;
  for (const m of moves) node = addMove(node, m);
  return { game, last: node };
}

describe('the move tree', () => {
  it('adds moves typed as SAN or dragged on the board', () => {
    const game = createGame();
    const e4 = addMove(game.root, 'e4');
    const e5 = addMove(e4, { from: 'e7', to: 'e5' });
    expect([e4.san, e4.uci, e5.san, e5.uci]).toEqual(['e4', 'e2e4', 'e5', 'e7e5']);
    expect(positionKey(e5.fen)).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -');
  });

  it('promotes a pawn dragged to the last rank', () => {
    const game = createGame('8/4P3/8/8/8/8/k7/4K3 w - - 0 1');
    const queen = addMove(game.root, { from: 'e7', to: 'e8', promotion: 'q' });
    expect(queen.san).toBe('e8=Q');
    expect(queen.uci).toBe('e7e8q');
  });

  it('refuses an illegal move', () => {
    const game = createGame();
    expect(() => addMove(game.root, 'e5')).toThrow(IllegalMoveError);
    expect(() => addMove(game.root, { from: 'e2', to: 'e5' })).toThrow(IllegalMoveError);
  });

  it('reuses a move that is already there instead of duplicating it', () => {
    const { game } = line('e4', 'e5');
    const again = addMove(game.root, 'e4');
    expect(game.root.children).toHaveLength(1);
    expect(again).toBe(game.root.children[0]);
  });

  it('makes a second move from the same position a variation', () => {
    const { game } = line('e4', 'e5');
    const d4 = addMove(game.root, 'd4');
    expect(game.root.children.map((n) => n.san)).toEqual(['e4', 'd4']);
    expect(isOnMainline(game.root, d4.id)).toBe(false);
    expect(isOnMainline(game.root, game.root.children[0]!.children[0]!.id)).toBe(true);
  });

  it('numbers moves from the ply', () => {
    const { last } = line('e4', 'e5', 'Nf3');
    expect([moveNumber(last), isWhiteMove(last)]).toEqual([2, true]);
    const black = createGame('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const c5 = addMove(black.root, 'c5');
    expect([moveNumber(c5), isWhiteMove(c5)]).toEqual([1, false]);
    expect(getHeader(black, 'SetUp')).toBe('1');
  });

  it('promotes a variation one level at a time, and all the way', () => {
    const { game } = line('e4', 'e5', 'Nf3');
    const e5 = game.root.children[0]!.children[0]!;
    const c5 = addMove(game.root.children[0]!, 'c5');
    const nc3 = addMove(c5, 'Nc3');
    addMove(c5, 'Nf3'); // main move after c5 is Nc3, Nf3 a variation
    const nf3AfterC5 = c5.children[1]!;

    expect(promoteVariation(game.root, nf3AfterC5.id)).toBe(true);
    expect(c5.children.map((n) => n.san)).toEqual(['Nf3', 'Nc3']);
    expect(isOnMainline(game.root, nf3AfterC5.id)).toBe(false);

    makeMainline(game.root, nc3.id);
    expect(isOnMainline(game.root, nc3.id)).toBe(true);
    expect(game.root.children[0]!.children.map((n) => n.san)).toEqual(['c5', 'e5']);
    expect(promoteVariation(game.root, nc3.id)).toBe(false);
    expect(mainlineFrom(game.root).map((n) => n.san)).toEqual(['', 'e4', 'c5', 'Nc3']);
    expect(e5.children[0]!.san).toBe('Nf3');
  });

  it('deletes a move with everything after it', () => {
    const { game, last } = line('e4', 'e5', 'Nf3', 'Nc6');
    const nf3 = pathTo(game.root, last.id)[3]!;
    const parent = deleteNode(game.root, nf3.id);
    expect(parent!.san).toBe('e5');
    expect(parent!.children).toEqual([]);
    expect(pathTo(game.root, last.id)).toEqual([]);
    expect(deleteNode(game.root, game.root.id)).toBeUndefined();
  });

  it('keeps one move assessment and one position evaluation at a time', () => {
    const { last } = line('e4');
    toggleNag(last, 1);
    toggleNag(last, 16);
    toggleNag(last, 5); // replaces !
    toggleNag(last, 146); // novelty sits beside the others
    expect(last.nags).toEqual([5, 16, 146]);
    toggleNag(last, 5);
    expect(last.nags).toEqual([16, 146]);
  });

  it('sets and clears a comment', () => {
    const { last } = line('e4');
    setComment(last, '  best by test ');
    expect(last.comments).toEqual(['best by test']);
    setComment(last, '');
    expect(last.comments).toEqual([]);
  });
});
