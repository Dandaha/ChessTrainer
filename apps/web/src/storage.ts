/**
 * Browser storage for per-browser conveniences only: the theme and the game
 * left on the board. Anything worth keeping goes to the server's database.
 */

import { useSyncExternalStore } from 'react';

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

const THEME_EVENT = 'chess-workspace:theme';

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  write('theme', theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function onThemeChange(listener: () => void): () => void {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
}

/** The theme, kept in step wherever it is changed (the sidebar button and Settings). */
export function useTheme(): Theme {
  return useSyncExternalStore(onThemeChange, currentTheme);
}

/** How the analysis engine runs: lines shown, how deep it searches, and an Elo to play at (null: full strength). */
export interface EngineSettings {
  lines: number;
  depth: number;
  elo: number | null;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = { lines: 3, depth: 40, elo: null };

export function readEngineSettings(): EngineSettings {
  try {
    const stored = JSON.parse(read('engine') ?? '{}') as Partial<EngineSettings>;
    return {
      lines: Number.isInteger(stored.lines) && stored.lines! >= 1 && stored.lines! <= 5 ? stored.lines! : DEFAULT_ENGINE_SETTINGS.lines,
      depth: Number.isInteger(stored.depth) && stored.depth! >= 1 && stored.depth! <= 60 ? stored.depth! : DEFAULT_ENGINE_SETTINGS.depth,
      elo: typeof stored.elo === 'number' ? stored.elo : null,
    };
  } catch {
    return DEFAULT_ENGINE_SETTINGS;
  }
}

export function writeEngineSettings(settings: EngineSettings): void {
  write('engine', JSON.stringify(settings));
}

/** The PGN of the game left on the board, so a reload does not lose it. */
export function readDraft(): string | null {
  return read('draft');
}

export function writeDraft(pgn: string): void {
  write('draft', pgn);
}
