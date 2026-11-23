import type { Arrow, Highlight, ShapeColor } from './tree.ts';

/**
 * NAGs (numeric annotation glyphs) and the board drawings PGN carries inside
 * comments as [%cal ...] (arrows) and [%csl ...] (square highlights), the
 * commands Lichess and ChessBase both write.
 */

/** The PGN suffixes that stand for NAGs 1 to 6. */
export const SUFFIX_TO_NAG: Record<string, number> = {
  '!': 1,
  '?': 2,
  '!!': 3,
  '??': 4,
  '!?': 5,
  '?!': 6,
};

const NAG_TO_SUFFIX: Record<number, string> = Object.fromEntries(
  Object.entries(SUFFIX_TO_NAG).map(([suffix, nag]) => [nag, suffix]),
);

/** The glyph shown on screen for a NAG, with its meaning. */
export const NAG_GLYPHS: Record<number, { glyph: string; label: string }> = {
  1: { glyph: '!', label: 'Good move' },
  2: { glyph: '?', label: 'Mistake' },
  3: { glyph: '!!', label: 'Brilliant move' },
  4: { glyph: '??', label: 'Blunder' },
  5: { glyph: '!?', label: 'Interesting move' },
  6: { glyph: '?!', label: 'Dubious move' },
  7: { glyph: '□', label: 'Only move' },
  10: { glyph: '=', label: 'Equal position' },
  13: { glyph: '∞', label: 'Unclear position' },
  14: { glyph: '⩲', label: 'White is slightly better' },
  15: { glyph: '⩱', label: 'Black is slightly better' },
  16: { glyph: '±', label: 'White is better' },
  17: { glyph: '∓', label: 'Black is better' },
  18: { glyph: '+−', label: 'White is winning' },
  19: { glyph: '−+', label: 'Black is winning' },
  22: { glyph: '⨀', label: 'Zugzwang' },
  32: { glyph: '⟳', label: 'Development' },
  36: { glyph: '→', label: 'Initiative' },
  40: { glyph: '↑', label: 'Attack' },
  132: { glyph: '⇆', label: 'Counterplay' },
  138: { glyph: '⨁', label: 'Time trouble' },
  146: { glyph: 'N', label: 'Novelty' },
};

/** How a NAG is written in PGN: the suffix for 1 to 6, $n for the rest. */
export function nagToPgn(nag: number): string {
  return NAG_TO_SUFFIX[nag] ?? `$${nag}`;
}

export function nagGlyph(nag: number): string {
  return NAG_GLYPHS[nag]?.glyph ?? `$${nag}`;
}

const COLOR_LETTERS: Record<string, ShapeColor> = { G: 'green', R: 'red', Y: 'yellow', B: 'blue' };
const LETTER_FOR_COLOR: Record<ShapeColor, string> = { green: 'G', red: 'R', yellow: 'Y', blue: 'B' };

const SHAPE_COMMAND = /\[%(cal|csl)\s+([^\]]*)\]/g;
const SQUARE = /^[a-h][1-8]$/;

export interface CommentParts {
  /** The comment without its drawing commands, whitespace collapsed. */
  text: string;
  arrows: Arrow[];
  highlights: Highlight[];
}

/** Takes [%cal] and [%csl] out of a comment. Other commands ([%clk], [%eval]) stay in the text. */
export function splitComment(raw: string): CommentParts {
  const arrows: Arrow[] = [];
  const highlights: Highlight[] = [];
  const text = raw.replace(SHAPE_COMMAND, (_all, kind: string, body: string) => {
    for (const item of body.split(',').map((s) => s.trim()).filter(Boolean)) {
      const color = COLOR_LETTERS[item[0] ?? ''];
      const from = item.slice(1, 3);
      const to = item.slice(3, 5);
      if (!color || !SQUARE.test(from)) continue;
      if (kind === 'cal' && SQUARE.test(to)) {
        arrows.push({ from, to, color } as Arrow);
      } else if (kind === 'csl' && item.length === 3) {
        highlights.push({ square: from, color } as Highlight);
      }
    }
    return ' ';
  });
  return { text: collapseWhitespace(text), arrows, highlights };
}

/** The drawing commands for a node's arrows and highlights, or '' when it has none. */
export function shapeCommands(arrows: Arrow[], highlights: Highlight[]): string {
  const parts: string[] = [];
  if (highlights.length) {
    parts.push(`[%csl ${highlights.map((h) => `${LETTER_FOR_COLOR[h.color]}${h.square}`).join(',')}]`);
  }
  if (arrows.length) {
    parts.push(`[%cal ${arrows.map((a) => `${LETTER_FOR_COLOR[a.color]}${a.from}${a.to}`).join(',')}]`);
  }
  return parts.join(' ');
}

/** A comment for reading on screen: every [%...] command hidden. */
export function displayComment(text: string): string {
  return collapseWhitespace(text.replace(/\[%[^\]]*\]/g, ' '));
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
