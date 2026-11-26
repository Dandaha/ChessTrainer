import { type Game, addMove, createGame, setComment, setHeader, writePgnGames } from '@chess/chess-core';
import type { SavedPosition } from './api.ts';

/**
 * A saved position as a PGN game: the position as its FEN, the title as the
 * event, the key idea and notes as comments, and the answer as moves when
 * they are legal from the position.
 */
export function savedToGame(saved: SavedPosition): Game {
  const game = createGame(saved.fen);
  setHeader(game, 'Event', saved.title);
  if (saved.sourceLabel) setHeader(game, 'Annotator', saved.sourceLabel);
  const parts = [
    saved.category && `Category: ${saved.category}`,
    saved.keyIdea && `Key idea: ${saved.keyIdea}`,
    saved.notesMd,
    saved.tags.length ? `Tags: ${saved.tags.join(', ')}` : null,
  ].filter(Boolean);
  setComment(game.root, parts.join(' | '));
  if (saved.answer) {
    let node = game.root;
    for (const move of saved.answer.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) {
      try {
        node = addMove(node, move);
      } catch {
        // An answer written in words stays in the comment instead.
        setComment(game.root, [...parts, `Answer: ${saved.answer}`].join(' | '));
        break;
      }
    }
  }
  return game;
}

export function savedToPgn(list: SavedPosition[]): string {
  return writePgnGames(list.map(savedToGame));
}
