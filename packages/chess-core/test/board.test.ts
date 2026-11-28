import { describe, expect, it } from 'vitest';
import { boardState, isPromotion, passTurn } from '../board.ts';
import { START_FEN } from '../positionKey.ts';

describe('boardState', () => {
  it('lists the legal destinations of each piece', () => {
    const state = boardState(START_FEN);
    expect(state.turn).toBe('white');
    expect(state.dests.get('e2')).toEqual(['e3', 'e4']);
    expect(state.dests.get('g1')?.sort()).toEqual(['f3', 'h3']);
    expect(state.dests.get('e1')).toBeUndefined();
    expect(state.check).toBe(false);
  });

  it('lists a promotion square once, not once per piece', () => {
    expect(boardState('8/4P3/8/8/8/8/k7/4K3 w - - 0 1').dests.get('e7')).toEqual(['e8']);
  });

  it('reports check and checkmate', () => {
    // Fool's mate.
    const mate = boardState('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(mate.check).toBe(true);
    expect(mate.outcome).toBe('checkmate');
    expect(mate.dests.size).toBe(0);
  });
});

describe('isPromotion', () => {
  it('is true only for a pawn reaching the last rank', () => {
    expect(isPromotion('8/4P3/8/8/8/8/k7/4K3 w - - 0 1', 'e7', 'e8')).toBe(true);
    expect(isPromotion(START_FEN, 'e2', 'e4')).toBe(false);
  });
});

describe('passTurn', () => {
  it('gives the move to the other side, without en passant', () => {
    expect(passTurn('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    expect(passTurn(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
  });

  it('refuses when the side to move is in check', () => {
    expect(passTurn('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBeNull();
  });
});
