import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  InvalidFenError,
  START_FEN,
  isValidFen,
  keyToFen,
  normalizeFen,
  positionKey,
} from '../positionKey.ts';

function keyAfter(moves: string[]): string {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  return positionKey(chess.fen());
}

describe('positionKey', () => {
  it('drops the move counters', () => {
    expect(positionKey(START_FEN)).toBe('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -');
    expect(positionKey(START_FEN.replace(' 0 1', ' 12 40'))).toBe(positionKey(START_FEN));
  });

  it('drops an en passant square when no pawn can capture', () => {
    const withSquare = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';
    const without = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
    expect(positionKey(withSquare)).toBe(positionKey(without));
    expect(positionKey(withSquare).endsWith(' -')).toBe(true);
  });

  it('keeps an en passant square when the capture is legal', () => {
    // 1.e4 d5 2.e5 f5: exf6 e.p. is legal.
    const fen = 'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3';
    expect(positionKey(fen)).toBe('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6');
  });

  it('drops an en passant square when the capture would expose the king along the rank', () => {
    // bxc6 e.p. removes both pawns from the fifth rank and the rook on h5 checks a5.
    expect(positionKey('4k3/8/8/KPp4r/8/8/8/8 w - c6 0 1')).toBe('4k3/8/8/KPp4r/8/8/8/8 w - -');
  });

  it('drops an en passant square when the capturing pawn is pinned on its file', () => {
    // exd6 e.p. would leave the e-file and the rook on e8 checks e1.
    expect(positionKey('4r1k1/8/8/3pP3/8/8/8/4K3 w - d6 0 1')).toBe('4r1k1/8/8/3pP3/8/8/8/4K3 w - -');
  });

  it('gives two move orders into the same position the same key', () => {
    expect(keyAfter(['Nf3', 'Nf6', 'g3'])).toBe(keyAfter(['g3', 'Nf6', 'Nf3']));
    expect(keyAfter(['e4', 'e5', 'Nf3', 'Nc6'])).toBe(keyAfter(['Nf3', 'Nc6', 'e4', 'e5']));
    // Different move counters, same position.
    expect(keyAfter(['Nf3', 'Nc6', 'Ng1', 'Nb8', 'Nf3', 'Nc6'])).toBe(keyAfter(['Nf3', 'Nc6']));
  });

  it('separates the same board with a different side to move', () => {
    const white = positionKey('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    const black = positionKey('4k3/8/8/8/8/8/8/4K3 b - - 0 1');
    expect(white).not.toBe(black);
  });

  it('separates the same board with different castling rights', () => {
    const can = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const cannot = positionKey('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1');
    expect(can).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
    expect(can).not.toBe(cannot);
  });

  it('drops castling rights whose king or rook has left its square', () => {
    expect(positionKey('4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1')).toBe('4k3/8/8/8/8/8/8/4K3 w - -');
    expect(positionKey('r3k2r/8/8/8/8/8/8/R3K1R1 w KQkq - 0 1')).toBe(
      'r3k2r/8/8/8/8/8/8/R3K1R1 w Qkq -',
    );
  });

  it('accepts a key and returns it unchanged', () => {
    const key = positionKey('rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3');
    expect(positionKey(key)).toBe(key);
  });

  it('tolerates surrounding whitespace', () => {
    expect(positionKey(`  ${START_FEN}\n`)).toBe(positionKey(START_FEN));
  });

  it('rejects text that is not a FEN', () => {
    expect(() => positionKey('not a fen')).toThrow(InvalidFenError);
    expect(() => positionKey('8/8/8/8/8/8/8/8 w - - 0 1')).toThrow(InvalidFenError);
    expect(isValidFen('8/8/8/8/8/8/8/8 w - - 0 1')).toBe(false);
    expect(isValidFen(START_FEN)).toBe(true);
  });
});

describe('normalizeFen', () => {
  it('normalises fields 3 and 4 and keeps the counters', () => {
    expect(normalizeFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
    );
    expect(normalizeFen('4k3/8/8/8/8/8/8/4K3 w KQkq - 7 30')).toBe('4k3/8/8/8/8/8/8/4K3 w - - 7 30');
  });

  it('turns a key back into a full FEN', () => {
    expect(keyToFen(positionKey(START_FEN))).toBe(START_FEN);
  });
});
