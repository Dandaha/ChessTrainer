import { ambiguousMoves } from '@chess/chess-core';

/**
 * Why a typed move could not be played, in words: a promotion without its piece, a move two pieces
 * could make, or simply not a legal move here.
 */
export function typedMoveProblem(fen: string, typed: string): string {
  const text = typed.trim();
  const which = ambiguousMoves(fen, text);
  if (which.length > 1 && which.every((san) => san.includes('='))) {
    return `${text}: say which piece to promote to, e.g. ${which[0]!.split('=')[0]}=Q.`;
  }
  if (which.length > 1) return `${text} could be ${which.join(' or ')}: say which piece.`;
  return `${text} is not a legal move here.`;
}
