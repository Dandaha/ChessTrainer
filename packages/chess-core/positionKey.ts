import { Chess, validateFen } from 'chess.js';

/**
 * The position key: the identity of a position everywhere in the app.
 *
 * It is FEN fields 1-4 (board, side to move, castling rights, en passant
 * square) with the move counters dropped, so two move orders that reach the
 * same position get the same key and transpositions are found for free.
 *
 * Two fields are normalised so that equal positions really compare equal:
 * - En passant is kept only when an en passant capture is legal. FEN writes
 *   the square after every double pawn push, which would split one position
 *   into two keys.
 * - A castling right is kept only when its king and rook still stand on their
 *   starting squares. Hand-written FENs often carry "KQkq" regardless.
 *
 * Every lookup by position goes through this file.
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class InvalidFenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFenError';
  }
}

/** The key of the position a FEN describes. Accepts a full FEN or a 4-field key. */
export function positionKey(fen: string): string {
  const [board, turn, castling, ep] = parseFields(fen);
  return [board, turn, normalizeCastling(board, castling), normalizeEnPassant(fen, ep)].join(' ');
}

/**
 * The same FEN with fields 3 and 4 normalised as in the key and the move
 * counters kept (or defaulted to "0 1"). Use it for a FEN a person pasted.
 */
export function normalizeFen(fen: string): string {
  const fields = parseFields(fen);
  const key = positionKey(fen);
  return `${key} ${fields[4]} ${fields[5]}`;
}

/** A full FEN for a key, with neutral move counters. */
export function keyToFen(key: string): string {
  return normalizeFen(key);
}

export function isValidFen(fen: string): boolean {
  try {
    parseFields(fen);
    return true;
  } catch {
    return false;
  }
}

/** Splits and validates a FEN; a 4-field key gets "0 1" counters. */
function parseFields(fen: string): [string, string, string, string, string, string] {
  const fields = fen.trim().split(/\s+/);
  if (fields.length === 4) fields.push('0', '1');
  if (fields.length !== 6) {
    throw new InvalidFenError(`A FEN has 6 fields; this one has ${fields.length}`);
  }
  const result = validateFen(fields.join(' '));
  if (!result.ok) throw new InvalidFenError(result.error ?? 'Invalid FEN');
  return fields as [string, string, string, string, string, string];
}

/** The piece on each square of a FEN board field, by square name. */
function boardSquares(board: string): Map<string, string> {
  const squares = new Map<string, string>();
  board.split('/').forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
      } else {
        squares.set(`${'abcdefgh'[file]}${rank}`, ch);
        file += 1;
      }
    }
  });
  return squares;
}

const CASTLING_NEEDS: Record<string, [string, string, string, string]> = {
  // right: king square, king piece, rook square, rook piece
  K: ['e1', 'K', 'h1', 'R'],
  Q: ['e1', 'K', 'a1', 'R'],
  k: ['e8', 'k', 'h8', 'r'],
  q: ['e8', 'k', 'a8', 'r'],
};

function normalizeCastling(board: string, castling: string): string {
  if (castling === '-') return '-';
  const squares = boardSquares(board);
  const kept = ['K', 'Q', 'k', 'q'].filter((right) => {
    if (!castling.includes(right)) return false;
    const [kingSq, king, rookSq, rook] = CASTLING_NEEDS[right]!;
    return squares.get(kingSq) === king && squares.get(rookSq) === rook;
  });
  return kept.length ? kept.join('') : '-';
}

function normalizeEnPassant(fen: string, ep: string): string {
  if (ep === '-') return '-';
  const [board, turn, castling] = parseFields(fen);
  // chess.js plays only castling moves its own castling field allows, so give
  // it the normalised rights; the en passant capture itself is unaffected.
  const chess = new Chess(`${board} ${turn} ${normalizeCastling(board, castling)} ${ep} 0 1`);
  const legal = chess.moves({ verbose: true }).some((m) => m.isEnPassant());
  return legal ? ep : '-';
}
