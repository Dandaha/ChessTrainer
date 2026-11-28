import type { GameSummary } from './api.ts';

/**
 * A game's facts in words for lists: its date as people write it, and how it went for me.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A PGN date ("2026.11.25", "2026.11.??", "2026.??.??") as "25 Nov 2026", "Nov 2026" or "2026". */
export function formatPgnDate(date: string | null | undefined): string {
  const [year, month, day] = (date ?? '').split('.');
  if (!year || !/^\d{4}$/.test(year)) return '';
  const m = Number(month);
  if (!(m >= 1 && m <= 12)) return year;
  const d = Number(day);
  return d >= 1 && d <= 31 ? `${d} ${MONTHS[m - 1]} ${year}` : `${MONTHS[m - 1]} ${year}`;
}

/** How the game went for me, when I know which side I played and it has a result. */
export function myOutcome(game: Pick<GameSummary, 'result' | 'myColor'>): 'Won' | 'Lost' | 'Drawn' | null {
  if (!game.myColor) return null;
  if (game.result === '1/2-1/2') return 'Drawn';
  if (game.result === '1-0') return game.myColor === 'white' ? 'Won' : 'Lost';
  if (game.result === '0-1') return game.myColor === 'black' ? 'Won' : 'Lost';
  return null;
}

/** The colour classes of an outcome chip. */
export const OUTCOME_CLASS: Record<'Won' | 'Lost' | 'Drawn', string> = {
  Won: 'bg-accent-soft text-accent',
  Lost: 'bg-danger/10 text-danger',
  Drawn: 'bg-surface-2 text-muted',
};
