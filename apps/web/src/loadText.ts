import { type Game, InvalidFenError, type PgnError, createGame, isValidFen, normalizeFen, readPgnGames } from '@chess/chess-core';

export type LoadResult = { game: Game; note?: string } | { error: string };

const LOOKS_LIKE_FEN = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/;

/** A FEN problem as a sentence of its own: "Missing white king.", without the "Invalid FEN:" prefix. */
export function fenProblem(error: Error): string {
  const why = error.message.replace(/^Invalid FEN:\s*/i, '').trim();
  return `${why.charAt(0).toUpperCase()}${why.slice(1)}`.replace(/\.?$/, '.');
}

/**
 * Turns pasted or opened text into a game: a FEN opens its position, a PGN its first game. Only the
 * games up to the first that reads are read, so a big file opens at once; the others are counted.
 */
export function loadText(raw: string): LoadResult {
  const text = raw.trim();
  if (!text) return { error: 'There is nothing to load.' };

  if (isValidFen(text)) return { game: createGame(text) };
  if (LOOKS_LIKE_FEN.test(text)) {
    try {
      normalizeFen(text);
    } catch (error) {
      if (error instanceof InvalidFenError) return { error: `This looks like a FEN, but it cannot be used: ${fenProblem(error)}` };
    }
  }

  let first: Game | undefined;
  let firstProblem: PgnError | undefined;
  let unreadable = 0;
  for (const item of readPgnGames(text)) {
    if ('game' in item) {
      first = item.game;
      break;
    }
    firstProblem ??= item.error;
    unreadable += 1;
  }
  if (!first) {
    return {
      error: firstProblem
        ? `This is not a PGN or FEN I can read. Line ${firstProblem.line}: ${firstProblem.message.replace(/\.?$/, '.')}`
        : 'No game found in this text.',
    };
  }
  const notes: string[] = [];
  const games = text.match(/^\s*\[Event\s/gm)?.length ?? 0;
  if (games > 1) notes.push(`Opened the first of ${games.toLocaleString('en')} games. To keep them all, import the file on the Games screen.`);
  if (unreadable) notes.push(`${unreadable === 1 ? 'One game' : `${unreadable} games`} before it could not be read.`);
  return notes.length ? { game: first, note: notes.join(' ') } : { game: first };
}
