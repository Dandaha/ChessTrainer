import { Chess } from 'chess.js';
import type { Color } from './board.ts';
import { positionKey } from './positionKey.ts';
import type { MoveNode } from './tree.ts';

/** How a game ended, as the rules see it at a position. */
export type GameEnd =
  | { kind: 'checkmate'; winner: Color; result: '1-0' | '0-1' }
  | { kind: 'stalemate' | 'insufficient' | 'threefold' | 'fifty-moves'; result: '1/2-1/2' };

/**
 * Whether the game is over at the last node of `path` (the moves from the start to it), and how:
 * checkmate, stalemate, a draw for lack of mating material, threefold repetition, or the 50-move rule
 * (claimable once 50 moves pass without a capture or pawn move).
 */
export function gameEnd(path: readonly MoveNode[]): GameEnd | null {
  const node = path.at(-1);
  if (!node) return null;
  const chess = new Chess(node.fen);
  if (chess.isCheckmate()) {
    const winner: Color = chess.turn() === 'w' ? 'black' : 'white';
    return { kind: 'checkmate', winner, result: winner === 'white' ? '1-0' : '0-1' };
  }
  if (chess.isStalemate()) return { kind: 'stalemate', result: '1/2-1/2' };
  if (chess.isInsufficientMaterial()) return { kind: 'insufficient', result: '1/2-1/2' };
  // Only positions since the last capture or pawn move can repeat (the halfmove clock counts them).
  const clock = Number(node.fen.split(' ')[4] ?? 0);
  if (clock >= 8) {
    const key = positionKey(node.fen);
    const recent = path.slice(-(clock + 1));
    if (recent.filter((n) => positionKey(n.fen) === key).length >= 3) return { kind: 'threefold', result: '1/2-1/2' };
  }
  if (clock >= 100) return { kind: 'fifty-moves', result: '1/2-1/2' };
  return null;
}

export function describeGameEnd(end: GameEnd): string {
  switch (end.kind) {
    case 'checkmate':
      return `Checkmate: ${end.winner === 'white' ? 'White' : 'Black'} wins.`;
    case 'stalemate':
      return 'Stalemate: a draw.';
    case 'insufficient':
      return 'Draw: neither side has enough material to mate.';
    case 'threefold':
      return 'Draw by threefold repetition.';
    case 'fifty-moves':
      return 'Draw by the 50-move rule: fifty moves without a capture or pawn move.';
  }
}
