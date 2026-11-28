import { OPENINGS } from './openingTable.ts';
import { playedPositionKey } from './positionKey.ts';

/**
 * Opening names by position, from Lichess's table (openingTable.ts). Imported on its own
 * ('@chess/chess-core/openings'), so the pages do not carry the table.
 */

export interface OpeningName {
  eco: string;
  name: string;
}

let byKey: Map<string, OpeningName> | null = null;
const table = () => (byKey ??= new Map(OPENINGS.map(([key, eco, name]) => [key, { eco, name }])));

/** The opening named at exactly this position, however it was reached; null if it has no name. */
export function openingAt(fen: string): OpeningName | null {
  return table().get(playedPositionKey(fen)) ?? null;
}

/**
 * The named opening a game reached: the last named position along its moves (FENs from the start,
 * as played), which is how Lichess classifies games. A transposition into a named position counts.
 */
export function classifyOpening(fens: readonly string[]): OpeningName | null {
  const named = table();
  // The longest named line is 36 plies: a position after the 40th is not one of them.
  for (let i = Math.min(fens.length, 41) - 1; i >= 0; i -= 1) {
    const hit = named.get(playedPositionKey(fens[i]!));
    if (hit) return hit;
  }
  return null;
}
