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
  const add = (from: Square, to: Square) => {
    const list = dests.get(from);
    if (!list) dests.set(from, [to]);
    else if (!list.includes(to)) list.push(to);
  };
  for (const move of chess.moves({ verbose: true })) {
    add(move.from, move.to);
    // Castling can also be done by putting the king on its rook.
    const rook = rookSquareFor(move);
    if (rook) add(move.from, rook);
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

/** The rook's square for a castling move (h1 for White's O-O), or null. */
function rookSquareFor(move: { flags: string; from: string }): Square | null {
  if (!move.flags.includes('k') && !move.flags.includes('q')) return null;
  return `${move.flags.includes('k') ? 'h' : 'a'}${move.from[1]}` as Square;
}

/**
 * The square a king really goes to when it is put on its own rook to castle (g1 for e1-h1), or null
 * when the move is not that.
 */
export function castleTarget(fen: string, from: string, to: string): string | null {
  const chess = new Chess(fen);
  const king = chess.get(from as Square);
  const rook = chess.get(to as Square);
  if (king?.type !== 'k' || rook?.type !== 'r' || rook.color !== king.color) return null;
  const castle = chess.moves({ square: from as Square, verbose: true }).find((m) => rookSquareFor(m) === to);
  return castle ? castle.to : null;
}

export type MaterialRole = 'q' | 'r' | 'b' | 'n' | 'p';

/** Points per piece, as chess sites count them. */
export const PIECE_POINTS: Record<MaterialRole, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };

export interface MaterialSide {
  /** The pieces this side has more of than the other, most valuable first: what it is up. */
  up: MaterialRole[];
  /** Its lead in points (0 for the side behind or level). */
  lead: number;
}

/**
 * The material difference on the board, as Lichess shows it: per piece type, how many more one side
 * has, and who leads by how many points. From the position alone, so a trade cancels out, a
 * promotion counts as the new piece, and a position set up by hand works too.
 */
export function materialBalance(fen: string): { white: MaterialSide; black: MaterialSide } {
  const roles: MaterialRole[] = ['q', 'r', 'b', 'n', 'p'];
  const count = { white: { q: 0, r: 0, b: 0, n: 0, p: 0 }, black: { q: 0, r: 0, b: 0, n: 0, p: 0 } };
  for (const ch of fen.split(' ')[0] ?? '') {
    const role = ch.toLowerCase() as MaterialRole;
    if (role in PIECE_POINTS) count[ch === role ? 'black' : 'white'][role] += 1;
  }
  const up = (side: 'white' | 'black', other: 'white' | 'black') =>
    roles.flatMap((role) => Array<MaterialRole>(Math.max(0, count[side][role] - count[other][role])).fill(role));
  const points = (side: 'white' | 'black') => roles.reduce((sum, role) => sum + PIECE_POINTS[role] * count[side][role], 0);
  const lead = points('white') - points('black');
  return { white: { up: up('white', 'black'), lead: Math.max(0, lead) }, black: { up: up('black', 'white'), lead: Math.max(0, -lead) } };
}

