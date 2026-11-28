import { createGame, isValidFen, playMove } from '@chess/chess-core';
import { z } from 'zod';
import { positionFacts } from './facts.ts';
import { type Analysis, type EngineLine, formatScore, scoreValue } from './score.ts';

/**
 * The tools the coach can call, written once and used by both the in-app
 * coach (Claude API) and the MCP server (Claude desktop app). Every number a
 * tool returns comes from Stockfish or from code, never from a guess.
 */

export interface ChessData {
  searchConcepts(query: string): unknown | Promise<unknown>;
  repertoireAt(fen: string): unknown | Promise<unknown>;
  gamesAt(fen: string): unknown | Promise<unknown>;
  openingStats?(fen: string): Promise<unknown>;
}

export interface ToolContext {
  analyse(fen: string, options: { depth?: number; multipv?: number }): Promise<Analysis>;
  data?: ChessData;
}

interface ChessTool<S extends z.ZodRawShape> {
  name: string;
  description: string;
  shape: S;
  run(input: z.infer<z.ZodObject<S>>, ctx: ToolContext): Promise<unknown>;
}

const fen = () =>
  z
    .string()
    .describe('The position as a FEN string.')
    .refine((f) => isValidFen(f), 'Not a valid FEN.');
const moves = (what: string) => z.array(z.string()).min(1).max(30).describe(what);

function sideOf(f: string): 'white' | 'black' {
  return f.split(' ')[1] === 'b' ? 'black' : 'white';
}

/** A line for the model: score from White's point of view, moves in SAN. */
function describeLine(line: EngineLine, rank: number) {
  return {
    rank,
    score: formatScore(line),
    ...(line.mate !== undefined ? { mateIn: line.mate } : { pawns: (line.cp ?? 0) / 100 }),
    moves: line.san.slice(0, 10).join(' '),
  };
}

/** Plays SAN (or UCI) moves from a position; stops at the first illegal one. */
function play(start: string, list: string[]) {
  let node = createGame(start).root;
  const played: string[] = [];
  for (const move of list) {
    const uci = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move);
    try {
      node = playMove(node, uci ? { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] } : move);
    } catch {
      return { fen: node.fen, played, illegal: move };
    }
    played.push(node.san);
  }
  return { fen: node.fen, played, illegal: null as string | null };
}

const POV = 'Scores are from White’s point of view: + is good for White, − for Black; #3 is mate in 3.';

function tool<S extends z.ZodRawShape>(def: ChessTool<S>): ChessTool<S> {
  return def;
}

export const evaluateTool = tool({
  name: 'evaluate',
  description: `Stockfish evaluation of a position: the score and the best lines (principal variations) for the top moves, with the search depth. ${POV}`,
  shape: { fen: fen(), multipv: z.number().int().min(1).max(5).optional().describe('How many best moves to show (default 3).') },
  async run({ fen: f, multipv }, ctx) {
    const a = await ctx.analyse(f, { depth: 18, multipv: multipv ?? 3 });
    return {
      fen: f,
      sideToMove: sideOf(f),
      engine: a.engine,
      depth: a.depth,
      pointOfView: POV,
      lines: a.lines.map((l, i) => describeLine(l, i + 1)),
      ...(a.lines.length === 0 ? { note: 'No legal moves: checkmate or stalemate.' } : {}),
    };
  },
});

export const compareMovesTool = tool({
  name: 'compare_moves',
  description: `Compares candidate moves in a position with Stockfish: the score after each, how much worse it is than the best move (in pawns, from the mover’s point of view), and the refutation line for the worse ones. ${POV}`,
  shape: { fen: fen(), moves: moves('Candidate moves in SAN (e.g. "Nd5") or UCI (e.g. "c3d5").') },
  async run({ fen: f, moves: candidates }, ctx) {
    const sign = sideOf(f) === 'white' ? 1 : -1;
    const base = await ctx.analyse(f, { depth: 18, multipv: 3 });
    const best = base.lines[0];
    if (!best) return { fen: f, note: 'No legal moves: checkmate or stalemate.' };
    // Every move, the best one included, is scored the same way: a search of the position after it at
    // one depth. Set against the root search, which looks a move deeper, the best move itself could
    // come out a few tenths "worse than best".
    const scored = new Map<string, { line: EngineLine | undefined; value: number }>();
    const score = async (move: string, after: string) => {
      let result = scored.get(move);
      if (!result) {
        const line = (await ctx.analyse(after, { depth: 17, multipv: 1 })).lines[0];
        // No reply: the move mated (its SAN ends in #) or stalemated.
        const value = line ? scoreValue(line) * sign : move.endsWith('#') ? 100 : 0;
        result = { line, value };
        scored.set(move, result);
      }
      return result;
    };
    const bestMove = best.san[0]!;
    const bestAfter = play(f, [bestMove]);
    const bestValue = bestAfter.illegal ? scoreValue(best) * sign : (await score(bestMove, bestAfter.fen)).value;
    const results = [];
    for (const candidate of candidates) {
      const after = play(f, [candidate]);
      if (after.illegal) {
        results.push({ move: candidate, error: 'Not a legal move in this position.' });
        continue;
      }
      const move = after.played[0]!;
      const { line, value } = await score(move, after.fen);
      const loss = Math.max(0, Math.round((bestValue - value) * 100) / 100);
      results.push({
        move,
        score: line ? formatScore(line) : move.endsWith('#') ? 'checkmate' : 'stalemate',
        lossVsBestInPawns: loss >= 50 ? 'loses a forced mate or allows one' : loss,
        isBest: move === bestMove,
        ...(loss > 0.3 && line ? { refutation: line.san.slice(0, 8).join(' ') } : {}),
      });
    }
    return {
      fen: f,
      sideToMove: sideOf(f),
      depth: base.depth,
      pointOfView: POV,
      best: { move: bestMove, score: formatScore(best), line: best.san.slice(0, 10).join(' ') },
      candidates: results,
    };
  },
});

export const playLineTool = tool({
  name: 'play_line',
  description: `Plays a line of moves from a position and reports the position at the end: its FEN, the Stockfish score there, captures and checks along the way, and the material and key facts at the end. ${POV}`,
  shape: { fen: fen(), moves: moves('The moves to play, in SAN or UCI, alternating sides from the side to move.') },
  async run({ fen: f, moves: list }, ctx) {
    const result = play(f, list);
    const before = positionFacts(f);
    const after = positionFacts(result.fen);
    const end = await ctx.analyse(result.fen, { depth: 16, multipv: 1 });
    return {
      startFen: f,
      played: result.played,
      ...(result.illegal ? { stoppedAt: result.illegal, note: `"${result.illegal}" is not legal after ${result.played.join(' ') || 'the start'}.` } : {}),
      endFen: result.fen,
      captures: result.played.filter((m) => m.includes('x')),
      checks: result.played.filter((m) => /[+#]$/.test(m)),
      materialBalanceBefore: before.material.balance,
      materialBalanceAfter: after.material.balance,
      evalAtEnd: end.lines[0] ? describeLine(end.lines[0], 1) : { note: 'No legal moves at the end: checkmate or stalemate.' },
      factsAtEnd: after.summary,
      pointOfView: POV,
    };
  },
});

export const positionFactsTool = tool({
  name: 'position_facts',
  description:
    'Facts about a position computed by code (no engine): material and balance, hanging and undefended pieces, pins, checks and captures available, pawn structure (isolated, doubled, passed, backward, islands), open and half-open files, king safety and mobility.',
  shape: { fen: fen() },
  async run({ fen: f }) {
    return positionFacts(f);
  },
});

export const findThreatsTool = tool({
  name: 'find_threats',
  description: `What the side NOT to move would play if it were their turn (the null-move idea): their best moves by Stockfish and how much each would gain, plus their checks and captures. Use it to explain what a move must prevent. ${POV}`,
  shape: { fen: fen() },
  async run({ fen: f }, ctx) {
    const mover = sideOf(f);
    const opponent = mover === 'white' ? 'black' : 'white';
    const facts = positionFacts(f);
    if (facts.inCheck) {
      return { sideToMove: mover, note: `${mover} is in check, so the threat is already on the board: the check itself.` };
    }
    const fields = f.split(' ');
    fields[1] = fields[1] === 'w' ? 'b' : 'w';
    fields[3] = '-';
    const passed = fields.join(' ');
    const now = await ctx.analyse(f, { depth: 16, multipv: 1 });
    const threats = await ctx.analyse(passed, { depth: 16, multipv: 3 });
    const sign = opponent === 'white' ? 1 : -1;
    const current = now.lines[0] ? scoreValue(now.lines[0]) * sign : 0;
    const passedFacts = positionFacts(passed);
    return {
      sideToMove: mover,
      threatsFor: opponent,
      pointOfView: POV,
      currentScore: now.lines[0] ? formatScore(now.lines[0]) : null,
      threats: threats.lines.map((l) => ({
        move: l.san[0],
        line: l.san.slice(0, 6).join(' '),
        scoreIfAllowed: formatScore(l),
        gainInPawns: Math.round((scoreValue(l) * sign - current) * 100) / 100,
      })),
      checks: passedFacts.checksAvailable,
      captures: passedFacts.capturesAvailable,
    };
  },
});

const needsData = (ctx: ToolContext) => {
  if (!ctx.data) throw new Error('The chess database is not available here.');
  return ctx.data;
};

export const searchConceptsTool = tool({
  name: 'search_concepts',
  description: 'Searches the user’s own concepts library (their chess wiki: plans, pawn structures, motifs, endgame technique) by name, alias or text. Cite matching concepts by title.',
  shape: { query: z.string().min(1).max(200) },
  async run({ query }, ctx) {
    return needsData(ctx).searchConcepts(query);
  },
});

export const getRepertoireTool = tool({
  name: 'get_repertoire',
  description: 'The user’s repertoire at a position: their prepared moves here, sidelines, expected opponent replies and their own comments.',
  shape: { fen: fen() },
  async run({ fen: f }, ctx) {
    return needsData(ctx).repertoireAt(f);
  },
});

export const searchGamesTool = tool({
  name: 'search_games',
  description: 'Games in the user’s library that reached this position (by any move order), with results and the moves played from it.',
  shape: { fen: fen() },
  async run({ fen: f }, ctx) {
    return needsData(ctx).gamesAt(f);
  },
});

export const openingStatsTool = tool({
  name: 'opening_stats',
  description: 'How often each move is played from this position on Lichess, with White wins / draws / Black wins (online; needs a Lichess token).',
  shape: { fen: fen() },
  async run({ fen: f }, ctx) {
    const data = needsData(ctx);
    if (!data.openingStats) return { error: 'Opening statistics are not available here.' };
    return data.openingStats(f);
  },
});

export const CHESS_TOOLS = [
  evaluateTool,
  compareMovesTool,
  playLineTool,
  positionFactsTool,
  findThreatsTool,
  searchConceptsTool,
  getRepertoireTool,
  searchGamesTool,
  openingStatsTool,
] as const;

export type ChessToolName = (typeof CHESS_TOOLS)[number]['name'];

/** Runs a tool by name with untrusted input; errors come back as { error } for the model to read. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  const found = CHESS_TOOLS.find((t) => t.name === name);
  if (!found) return { error: `There is no tool called ${name}.` };
  const parsed = z.object(found.shape as z.ZodRawShape).safeParse(input);
  if (!parsed.success) return { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  try {
    return await (found.run as (i: unknown, c: ToolContext) => Promise<unknown>)(parsed.data, ctx);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** The tools as JSON Schema definitions (name, description, input schema). */
export function toolDefinitions(): { name: string; description: string; input_schema: Record<string, unknown> }[] {
  return CHESS_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(z.object(t.shape as z.ZodRawShape)) as Record<string, unknown>,
  }));
}
