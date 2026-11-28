import { Chess, type Square } from 'chess.js';
import { isValidFen } from './positionKey.ts';

/** What a board needs to know about a position to let a person move on it. */

export type Color = 'white' | 'black';

export interface BoardState {
  /** FEN field 1, the piece placement. */
  placement: string;
  turn: Color;
  /** Legal destinations for each square that has a movable piece. */
  dests: Map<Square, Square[]>;
  /** Whether the side to move is in check. */
  check: boolean;
  /** Checkmate, stalemate or another draw by rule; undefined while the game goes on. */
  outcome?: 'checkmate' | 'stalemate' | 'draw';
}

export function boardState(fen: string): BoardState {
  const chess = new Chess(fen);
  const dests = new Map<Square, Square[]>();
  for (const move of chess.moves({ verbose: true })) {
    const list = dests.get(move.from);
    if (list) {
      if (!list.includes(move.to)) list.push(move.to);
    } else {
      dests.set(move.from, [move.to]);
    }
  }
  const outcome = chess.isCheckmate()
    ? 'checkmate'
    : chess.isStalemate()
      ? 'stalemate'
      : chess.isInsufficientMaterial()
        ? 'draw'
        : undefined;
  return {
    placement: fen.split(' ')[0]!,
    turn: chess.turn() === 'w' ? 'white' : 'black',
    dests,
    check: chess.inCheck(),
    ...(outcome ? { outcome } : {}),
  };
}

/** Whether moving from one square to another is a pawn reaching the last rank. */
export function isPromotion(fen: string, from: string, to: string): boolean {
  const chess = new Chess(fen);
  return chess
    .moves({ verbose: true })
    .some((m) => m.from === from && m.to === to && m.promotion !== undefined);
}

/**
 * The position with the other side to move, as if the side to move passed: what threat mode looks
 * at, to show what the opponent would play if it were their turn. Null when the side to move is in
 * check, since passing would leave the king to be taken.
 */
export function passTurn(fen: string): string | null {
  if (!isValidFen(fen) || new Chess(fen).inCheck()) return null;
  const [placement, turn, castling, , , fullmove = '1'] = fen.trim().split(/\s+/);
  const next = [placement, turn === 'w' ? 'b' : 'w', castling, '-', '0', String(Number(fullmove) + (turn === 'b' ? 1 : 0))].join(' ');
  return isValidFen(next) ? next : null;
}
