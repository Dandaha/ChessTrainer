import { describe, expect, it } from 'vitest';
import { classifyOpening, openingAt } from '../openings.ts';
import { parseGame } from '../pgn.ts';
import { mainlineFrom } from '../tree.ts';

const fens = (moves: string) => mainlineFrom(parseGame(`${moves} *`).root).map((n) => n.fen);

describe('classifyOpening', () => {
  it('names the deepest opening a game reaches', () => {
    expect(classifyOpening(fens('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. f3'))).toMatchObject({ eco: 'B90' });
    expect(classifyOpening(fens('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6'))?.name).toBe('Sicilian Defense: Najdorf Variation');
  });

  it('finds it through a transposition, and keeps the last name when the game leaves the book', () => {
    const queensGambit = classifyOpening(fens('1. d4 d5 2. c4 e6'))!;
    expect(classifyOpening(fens('1. c4 e6 2. d4 d5'))).toEqual(queensGambit);
    expect(classifyOpening(fens('1. d4 d5 2. c4 e6 3. h4 h5 4. a4 a5'))).toEqual(queensGambit);
  });

  it('says nothing for a game from a position no opening reaches', () => {
    expect(classifyOpening(['8/8/8/4k3/8/8/4P3/4K3 w - - 0 1'])).toBeNull();
  });
});

describe('openingAt', () => {
  it('names a position only if it is a named one, whatever the move counters', () => {
    const najdorf = fens('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6').at(-1)!;
    expect(openingAt(najdorf)?.name).toBe('Sicilian Defense: Najdorf Variation');
    expect(openingAt(najdorf.replace(/ \d+ \d+$/, ' 7 40'))?.name).toBe('Sicilian Defense: Najdorf Variation');
    expect(openingAt(fens('1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. h3 h6 7. a3').at(-1)!)).toBeNull();
    expect(openingAt('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1')).toBeNull();
  });
});
