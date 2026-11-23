import { type Game, InvalidFenError, createGame, isValidFen, normalizeFen, parsePgn } from '@chess/chess-core';

export type LoadResult = { game: Game; note?: string } | { error: string };

const LOOKS_LIKE_FEN = /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/;

/** Turns pasted or opened text into a game: a FEN opens its position, a PGN its first game. */
export function loadText(raw: string): LoadResult {
  const text = raw.trim();
  if (!text) return { error: 'There is nothing to load.' };

  if (isValidFen(text)) return { game: createGame(text) };
  if (LOOKS_LIKE_FEN.test(text)) {
    try {
      normalizeFen(text);
    } catch (error) {
      if (error instanceof InvalidFenError) return { error: `This looks like a FEN, but: ${error.message}.` };
    }
  }

  const { games, errors } = parsePgn(text);
  const first = games[0];
  if (!first) {
    const problem = errors[0];
    return {
      error: problem
        ? `This is not a PGN or FEN I can read. Line ${problem.line}: ${problem.message}.`
        : 'No game found in this text.',
    };
  }
  const notes: string[] = [];
  if (games.length > 1) {
    notes.push(`Opened the first of ${games.length} games; the game library for many games comes in phase 2.`);
  }
  if (errors.length) notes.push(`${errors.length} game(s) could not be read.`);
  return notes.length ? { game: first, note: notes.join(' ') } : { game: first };
}
