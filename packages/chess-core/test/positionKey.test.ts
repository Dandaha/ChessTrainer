import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import {
  InvalidFenError,
  START_FEN,
  isValidFen,
  keyToFen,
  normalizeFen,
  playedPositionKey,
  positionHash,
  positionKey,
} from '../positionKey.ts';
import { parseGame } from '../pgn.ts';
import { type MoveNode } from '../tree.ts';

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

  it('rejects a position where the side that just moved is still in check', () => {
    // White to move with the black king attacked: no game can reach it, and Rxe8 would take the king.
    expect(() => positionKey('4k3/8/8/8/8/8/8/4RK2 w - - 0 1')).toThrow('Black is in check but it is White');
    expect(() => positionKey('4k3/4r3/8/8/8/8/8/4K3 b - - 0 1')).toThrow('White is in check but it is Black');
    // Check against the side to move is normal.
    expect(isValidFen('4k3/8/8/8/8/8/8/4RK2 b - - 0 1')).toBe(true);
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

describe('playedPositionKey and positionHash', () => {
  it('give the same key as positionKey for every position of real play', () => {
    // En passant both capturable and not, castling lost by moving and by capture, promotion.
    const game = parseGame(`[FEN "r3k2r/1pp2ppp/8/3pP3/8/8/PPP2PPP/R3K2R w KQkq d6 0 12"]

12. exd6 (12. Kf1 b5 13. a4 bxa4 14. b4 axb3 15. Ke2) 12... cxd6 13. a4 b5 14. axb5 Rxa1+ 15. Ke2 Rxh1 16. g4 Rxh2 17. b6 Kd7 18. b7 Ke6 19. b8=Q *`);
    const all: MoveNode[] = [];
    const walk = (node: MoveNode) => {
      all.push(node);
      node.children.forEach(walk);
    };
    walk(game.root);
    expect(all.length).toBeGreaterThan(20);
    for (const node of all) expect(playedPositionKey(node.fen)).toBe(positionKey(node.fen));
  });

  it('drops an en passant square nothing can take on, without asking chess.js', () => {
    expect(playedPositionKey('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1')).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -',
    );
  });

  it('hashes a key to a fixed 64-bit number, different for different positions', () => {
    const start = positionKey(START_FEN);
    expect(positionHash(start)).toBe(positionHash(start));
    expect(positionHash(start)).toBe(-9171046728754406140n);
    const keys = new Set<string>();
    const hashes = new Set<bigint>();
    for (const m of ['e4', 'd4', 'c4', 'Nf3', 'g3', 'b3', 'f4', 'Nc3', 'b4', 'e3']) {
      const key = keyAfter([m]);
      keys.add(key);
      hashes.add(positionHash(key));
      expect(positionHash(key)).toBeGreaterThanOrEqual(-(2n ** 63n));
      expect(positionHash(key)).toBeLessThan(2n ** 63n);
    }
    expect(hashes.size).toBe(keys.size);
  });
});
