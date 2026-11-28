import { describe, expect, it } from 'vitest';
import { createGame, describeGameEnd, gameEnd, playMove, type MoveNode } from '../index.ts';

/** The rules' ways a game ends, read from the moves that led to a position. */

function line(fen: string | undefined, sans: string[]): MoveNode[] {
  const path = [createGame(fen).root];
  for (const san of sans) path.push(playMove(path.at(-1)!, san));
  return path;
}

describe('gameEnd', () => {
  it('sees checkmate and who won', () => {
    const end = gameEnd(line(undefined, ['f3', 'e5', 'g4', 'Qh4#']));
    expect(end).toEqual({ kind: 'checkmate', winner: 'black', result: '0-1' });
    expect(describeGameEnd(end!)).toBe('Checkmate: Black wins.');
  });

  it('sees stalemate and too little material to mate', () => {
    expect(gameEnd(line('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', []))?.kind).toBe('stalemate');
    expect(gameEnd(line('8/8/4k3/8/8/4K3/4N3/8 w - - 0 1', []))?.kind).toBe('insufficient');
  });

  it('sees a position repeated three times, wherever the repetitions fall', () => {
    const moves = ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8'];
    expect(gameEnd(line(undefined, moves.slice(0, 7)))).toBeNull();
    expect(gameEnd(line(undefined, moves))).toEqual({ kind: 'threefold', result: '1/2-1/2' });
  });

  it('sees the 50-move rule from the halfmove clock', () => {
    expect(gameEnd(line('8/8/4k3/8/8/4K3/4R3/8 w - - 99 80', []))).toBeNull();
    expect(gameEnd(line('8/8/4k3/8/8/4K3/4R3/8 w - - 99 80', ['Ra2']))?.kind).toBe('fifty-moves');
  });

  it('is null while the game goes on', () => {
    expect(gameEnd(line(undefined, ['e4', 'e5']))).toBeNull();
  });
});
