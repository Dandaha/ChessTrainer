/**
 * Browser storage for per-browser conveniences only: the theme and the game
 * left on the board. Anything worth keeping goes to the server's database.
 */

const PREFIX = 'chess-workspace:';

export type Theme = 'light' | 'dark';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Storage full or blocked: the convenience is lost, nothing else.
  }
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  write('theme', theme);
}

/** The PGN of the game left on the board, so a reload does not lose it. */
export function readDraft(): string | null {
  return read('draft');
}

export function writeDraft(pgn: string): void {
  write('draft', pgn);
}
