import { createGame, playMove } from '@chess/chess-core';

/**
 * Engine lines and scores, without the process: safe to import in the browser
 * (the engine itself is engine.ts, which needs Node).
 */

export interface EngineLine {
  /** 1 for the best line, 2 for the second... */
  multipv: number;
  depth: number;
  /** Centipawns from White's point of view; absent when there is a mate score. */
  cp?: number;
  /** Moves to mate from White's point of view: positive, White mates; negative, Black mates. */
  mate?: number;
  /** The line in UCI (e2e4) and in SAN (e4). */
  pv: string[];
  san: string[];
}

export interface Analysis {
  fen: string;
  engine: string;
  depth: number;
  lines: EngineLine[];
}

/** The SAN of a UCI line from a position, as far as it stays legal. */
export function uciToSan(fen: string, pv: string[]): string[] {
  const out: string[] = [];
  let node = createGame(fen).root;
  for (const uci of pv) {
    try {
      node = playMove(node, { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    } catch {
      break;
    }
    out.push(node.san);
  }
  return out;
}

/** "+0.35", "-1.20", "#3", "-#2": a score for people. */
export function formatScore(line: Pick<EngineLine, 'cp' | 'mate'>): string {
  if (line.mate !== undefined) return line.mate > 0 ? `#${line.mate}` : `-#${-line.mate}`;
  const pawns = (line.cp ?? 0) / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

/** A score as a number of pawns for comparing lines; mates count as ±100. */
export function scoreValue(line: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (line.mate !== undefined) return line.mate > 0 ? 100 - line.mate / 100 : -100 - line.mate / 100;
  return (line.cp ?? 0) / 100;
}

