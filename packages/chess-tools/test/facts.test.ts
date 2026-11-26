import { describe, expect, it } from 'vitest';
import { positionFacts } from '../facts.ts';

describe('positionFacts', () => {
  it('counts material and the balance', () => {
    const f = positionFacts('4k3/8/8/8/8/8/8/R3K1N1 w - - 0 1');
    expect(f.material.white).toMatchObject({ R: 1, N: 1, points: 8 });
    expect(f.material.balance).toBe(8);
    expect(f.summary).toContain('White is up 8 points of material.');
  });

  it('finds a hanging piece and one attacked by a cheaper piece', () => {
    // The knight on e5 is attacked by the d6 pawn and defended by nothing; the queen on c4 by a pawn on b5.
    const f = positionFacts('4k3/8/3p4/1p2N3/2Q5/8/8/4K3 w - - 0 1');
    const hanging = f.hanging.map((h) => [h.square, h.reason]);
    expect(hanging).toEqual(expect.arrayContaining([['e5', 'undefended'], ['c4', 'attacked by a cheaper piece']]));
  });

  it('finds an absolute pin and a pin to the queen', () => {
    // Bb5 pins the c6 knight to the king on e8; Bg5 pins the f6 knight to the queen on d8.
    const f = positionFacts('r2qkb1r/pppb1ppp/2np1n2/1B2p1B1/4P3/2N2N2/PPPP1PPP/R2QK2R w KQkq - 0 1');
    const pins = f.pins.map((p) => [p.pinned.square, p.to.piece, p.absolute]);
    expect(pins).toEqual(expect.arrayContaining([['f6', 'queen', false]]));
    expect(f.summary.some((s) => s.startsWith("Black's knight on f6 is pinned to the queen on d8 by the bishop on g5"))).toBe(true);
    const absolute = positionFacts('4k3/8/2n5/1B6/8/8/8/4K3 b - - 0 1').pins[0]!;
    expect(absolute).toMatchObject({ pinned: { square: 'c6' }, to: { piece: 'king' }, absolute: true });
  });

  it('describes the pawn structure', () => {
    // White: isolated d4, doubled c-pawns; Black: passed a-pawn.
    const f = positionFacts('4k3/p4ppp/8/8/2PP4/2P5/5PPP/4K3 w - - 0 1');
    expect(f.pawns.white.doubled.sort()).toEqual(['c3', 'c4']);
    expect(f.pawns.black.passed).toEqual(['a7']);
    expect(f.pawns.white.islands).toBe(2);
    expect(f.files.open).toEqual(['b', 'e']);
    expect(f.files.halfOpen.white).toEqual(['a']);
  });

  it('finds an isolated pawn and a backward pawn', () => {
    expect(positionFacts('4k3/8/8/3p4/3P4/8/8/4K3 w - - 0 1').pawns.white.isolated).toEqual(['d4']);
    // d6 cannot be supported by a c- or e-pawn and its stop square d5 is hit by the c4 pawn.
    const f = positionFacts('4k3/8/3p4/4p3/2P1P3/8/8/4K3 b - - 0 1');
    expect(f.pawns.black.backward).toEqual(['d6']);
  });

  it('judges king safety and lists checks', () => {
    const f = positionFacts('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    expect(f.kings.black).toMatchObject({ square: 'g8', castled: true, shieldPawns: 3 });
    expect(f.checksAvailable).toEqual(['Rd8#']);
    expect(f.mobility.black).toBeGreaterThan(0);
  });

  it('works when the side to move is in check', () => {
    const f = positionFacts('4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
    expect(f.inCheck).toBe(true);
    expect(f.mobility.black).toBeNull();
  });
});
