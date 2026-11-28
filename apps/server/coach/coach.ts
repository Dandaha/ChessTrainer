import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createGame, isWhiteMove, moveLabel, playMove } from '@chess/chess-core';
import { type ToolContext, runTool, toolDefinitions } from '@chess/chess-tools';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import { recordExchange } from '../db/coach.ts';
import { conceptsAtPosition } from '../db/concepts.ts';
import { getSettings } from '../db/library.ts';
import { repertoiresAt } from '../db/repertoire.ts';
import { explorerToken } from '../src/explorer.ts';

/**
 * The in-app coach: Claude in a tool-use loop over the chess tools. The code
 * supplies the facts (Stockfish, computed facts, the user's database); the
 * model supplies the reasoning and the words. Text streams to the browser as
 * it is written, and the tokens of every call are logged in coach_messages.
 */

export const COACH_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'] as const;
export type CoachModel = (typeof COACH_MODELS)[number];
export const DEFAULT_QUICK_MODEL: CoachModel = 'claude-haiku-5-5';
export const DEFAULT_DEEP_MODEL: CoachModel = 'claude-sonnet-5-5';

export type CoachMode = 'explain_move' | 'why_not' | 'plan' | 'review_game' | 'explain_opening' | 'tag_position' | 'ask';
const DEEP_MODES: CoachMode[] = ['plan', 'review_game', 'explain_opening'];

const here = dirname(fileURLToPath(import.meta.url));
/** Read once: a frozen system prompt keeps the prompt cache warm. */
export const SYSTEM_PROMPT = readFileSync(resolve(here, 'systemPrompt.md'), 'utf8');

export interface CoachRequest {
  mode: CoachMode;
  /** The position the question is about. */
  fen: string;
  /** Where the game on the board starts, and the moves from there to `fen`. */
  startFen: string;
  moves: string[];
  myColor?: 'white' | 'black';
  /** The user's own words, for "ask". */
  question?: string;
  /** The move asked about, for "why_not". */
  candidate?: string;
  /** Use the deeper model whatever the mode. */
  deep?: boolean;
}

export interface Arrow {
  from: string;
  to: string;
  color: 'green' | 'red' | 'blue' | 'yellow';
}

export interface Annotations {
  arrows: Arrow[];
  highlights: { square: string; color: Arrow['color'] }[];
  /** Lines from the current position, legal-checked, as SAN. */
  lines: { label: string; moves: string[] }[];
}

export interface Suggestions {
  concepts: string[];
  newConcepts: string[];
  tags: string[];
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type CoachEvent =
  | { type: 'status'; text: string }
  | { type: 'text'; text: string }
  | { type: 'annotations'; annotations: Annotations }
  | { type: 'suggestions'; suggestions: Suggestions }
  | { type: 'moments'; moments: ReviewMoment[] }
  | { type: 'done'; model: string; usage: Usage; costUsd: number; messageId: string }
  | { type: 'error'; error: string };

export interface ReviewMoment {
  ply: number;
  move: string;
  before: string;
  after: string;
  best: string;
  lossInPawns: number;
}

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];
type Message = Anthropic.Beta.BetaMessage;

/** The part of the SDK client the coach uses, so tests can stand in for it. */
export interface StreamingClient {
  stream(
    params: StreamParams,
    options?: { signal?: AbortSignal },
  ): { on(event: 'text', listener: (delta: string) => void): unknown; finalMessage(): Promise<Message> };
}

export function sdkClient(apiKey: string): StreamingClient {
  const client = new Anthropic({ apiKey });
  return { stream: (params, options) => client.beta.messages.stream(params, options) };
}

export interface CoachDeps {
  db: Db;
  client: StreamingClient;
  tools: ToolContext;
  /** Aborted when the person closes the panel or leaves: stop calling the model. */
  signal?: AbortSignal;
}

// --- Prices, for the spending note (USD per million tokens, Nov 2026; an estimate) ---

const PRICES: Record<CoachModel, { input: number; output: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

export function estimateCost(model: string, usage: Usage): number {
  const p = PRICES[model as CoachModel] ?? PRICES['claude-sonnet-5-5'];
  // Cache writes cost 1.25x the input price.
  return (usage.input * p.input + usage.cacheWrite * p.input * 1.25 + usage.cacheRead * p.cacheRead + usage.output * p.output) / 1_000_000;
}

// --- The app's own tools: drawing on the board and suggesting tags ---

const colorEnum = z.enum(['green', 'red', 'blue', 'yellow']);
const square = z.string().regex(/^[a-h][1-8]$/);
const showOnBoardShape = {
  arrows: z.array(z.object({ from: square, to: square, color: colorEnum })).max(8).optional(),
  highlights: z.array(z.object({ square, color: colorEnum })).max(8).optional(),
  lines: z
    .array(z.object({ label: z.string().max(80), moves: z.array(z.string()).min(1).max(16) }))
    .max(4)
    .optional()
    .describe('Key lines as SAN moves starting from the current position.'),
};
const suggestTagsShape = {
  concepts: z.array(z.string()).max(6).describe('Titles of existing concepts from search_concepts that fit.'),
  newConcepts: z.array(z.string()).max(4).describe('Concepts worth creating, by title.'),
  tags: z.array(z.string()).max(8).describe('Short lower-case tags.'),
};

function appTools(mode: CoachMode): Anthropic.Beta.BetaTool[] {
  const tools: Anthropic.Beta.BetaTool[] = [
    {
      name: 'show_on_board',
      description:
        'Draws on the user’s board next to your answer: arrows, square highlights, and clickable key lines (SAN from the current position). Call it once, near the end.',
      input_schema: jsonSchema(showOnBoardShape),
      eager_input_streaming: true,
    },
  ];
  if (mode === 'tag_position') {
    tools.push({
      name: 'suggest_tags',
      description: 'Proposes concepts and tags for the saved position; the user confirms them in the app.',
      input_schema: jsonSchema(suggestTagsShape),
      eager_input_streaming: true,
    });
  }
  return tools;
}

function jsonSchema(shape: z.ZodRawShape): Anthropic.Beta.BetaTool['input_schema'] {
  const { $schema: _drop, ...schema } = z.toJSONSchema(z.object(shape)) as Record<string, unknown>;
  return schema as Anthropic.Beta.BetaTool['input_schema'];
}

/** The chess tools for the API, without opening_stats unless a Lichess token is set. */
function chessTools(): Anthropic.Beta.BetaTool[] {
  return toolDefinitions()
    .filter((t) => t.name !== 'opening_stats' || explorerToken())
    .map((t) => {
      const { $schema: _drop, ...schema } = t.input_schema;
      return { name: t.name, description: t.description, input_schema: schema as Anthropic.Beta.BetaTool['input_schema'], eager_input_streaming: true };
    });
}

// --- The context packet ---

function movesText(startFen: string, sans: string[]): string {
  const start = createGame(startFen).root;
  return sans.map((san, i) => moveLabel(start.ply + i + 1, san)).join(' ');
}

function contextPacket(db: Db, req: CoachRequest): string {
  const settings = getSettings(db);
  const toMove = req.fen.split(' ')[1] === 'b' ? 'Black' : 'White';
  const lines = [
    `Position (FEN): ${req.fen}`,
    `${toMove} to move.`,
    req.moves.length
      ? `Moves so far${req.startFen === createGame().root.fen ? '' : ` from ${req.startFen}`}: ${movesText(req.startFen, req.moves)}`
      : 'No moves played yet in this game.',
  ];
  if (req.myColor) lines.push(`The user plays ${req.myColor === 'white' ? 'White' : 'Black'} in this game.`);
  lines.push(typeof settings.rating === 'number' ? `The user’s rating: about ${settings.rating}.` : 'The user’s rating is not set; aim at a club player.');
  const repertoire = repertoiresAt(db, req.fen);
  if (repertoire.length) {
    lines.push(
      `Repertoire here: ${repertoire
        .map(({ repertoire: r, moves }) =>
          moves.length
            ? `${r.name} (${r.color}): ${moves.map((m) => `${m.san}${m.isMyMove ? ' (my move)' : ' (expected reply)'}${m.comment ? ` – ${m.comment}` : ''}`).join(', ')}`
            : `${r.name} (${r.color}) reaches this position but prepares nothing further`,
        )
        .join('; ')}.`,
    );
  }
  const concepts = conceptsAtPosition(db, req.fen);
  if (concepts.length) lines.push(`Concepts the user linked to this position: ${concepts.map((c) => c.title).join(', ')}.`);
  return lines.join('\n');
}

function questionFor(req: CoachRequest): string {
  const last = req.moves.at(-1);
  const start = createGame(req.startFen).root;
  const lastLabel = last ? moveLabel(start.ply + req.moves.length, last) : null;
  switch (req.mode) {
    case 'explain_move':
      return lastLabel
        ? `Explain the move just played, ${lastLabel}: is it good or bad, and why? Compare it with what the engine preferred in the position before it (FEN: ${fenBefore(req)}).`
        : 'Explain the best move in this position and the idea behind it.';
    case 'why_not':
      return `Why not ${req.candidate}? Compare it with the best move here and show what refutes it, if anything does.`;
    case 'plan':
      return 'What is the plan here, for both sides? Base it on the position’s structure (position_facts) and the engine’s lines.';
    case 'explain_opening':
      return 'Explain the opening that led here: its main ideas, typical plans and pawn structures, and how it connects to my repertoire.';
    case 'tag_position':
      return 'Which of my concepts (search_concepts) fit this position, which new concepts would be worth creating, and which short tags describe it? Call suggest_tags with them, then explain the choice in two or three sentences.';
    case 'review_game':
      return 'Review this game.';
    case 'ask':
      return req.question?.trim() || 'What is going on in this position?';
  }
}

function fenBefore(req: CoachRequest): string {
  let node = createGame(req.startFen).root;
  for (const san of req.moves.slice(0, -1)) node = playMove(node, san);
  return node.fen;
}

/** Lines the model proposed, kept only as far as they are legal. */
function checkLines(fen: string, lines: { label: string; moves: string[] }[] = []) {
  return lines
    .map((line) => {
      let node = createGame(fen).root;
      const moves: string[] = [];
      for (const san of line.moves) {
        try {
          node = playMove(node, san.replace(/^\d+\.(\.\.)?\s*/, ''));
        } catch {
          break;
        }
        moves.push(node.san);
      }
      return { label: line.label, moves };
    })
    .filter((l) => l.moves.length > 0);
}

/**
 * Blocks to send back for the next turn. After a mid-output fallback, the
 * thinking and tool_use blocks before the last fallback block are left out;
 * the fallback block itself stays where it was.
 */
function echo(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlockParam[] {
  const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
  return content.filter(
    (b, i) => i >= lastFallback || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type),
  ) as Anthropic.Beta.BetaContentBlockParam[];
}

const MAX_TURNS = 12;

export function modelFor(db: Db, req: CoachRequest): CoachModel {
  const settings = getSettings(db);
  const pick = (value: unknown, fallback: CoachModel) =>
    COACH_MODELS.includes(value as CoachModel) ? (value as CoachModel) : fallback;
  return req.deep || DEEP_MODES.includes(req.mode)
    ? pick(settings.coachDeepModel, DEFAULT_DEEP_MODEL)
    : pick(settings.coachQuickModel, DEFAULT_QUICK_MODEL);
}

/** Answers one question, streaming events; returns when the answer is complete. */
export async function runCoach(
  deps: CoachDeps,
  req: CoachRequest,
  emit: (event: CoachEvent) => void,
  extraContext = '',
): Promise<void> {
  const model = modelFor(deps.db, req);
  const userText = `${contextPacket(deps.db, req)}${extraContext ? `\n\n${extraContext}` : ''}\n\nQuestion: ${questionFor(req)}`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: userText }];
  const tools = [...chessTools(), ...appTools(req.mode)];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const trace: { tool: string; input: unknown; error?: string }[] = [];
  let answer = '';
  let annotations: Annotations | null = null;
  let suggestions: Suggestions | null = null;
  const perCall: Usage[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (deps.signal?.aborted) return;
    const params: StreamParams = {
      model,
      max_tokens: 64000,
      // Stable first: tools and system are cached; the auto breakpoint caches the growing conversation.
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      cache_control: { type: 'ephemeral' },
      tools,
      messages,
      output_config: { effort: 'medium' },
      // Haiku 5.5 has no server-side fallback; Sonnet and Opus fall back on a refusal.
      ...(model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    };
    const stream = deps.client.stream(params, { signal: deps.signal });
    stream.on('text', (delta) => {
      answer += delta;
      emit({ type: 'text', text: delta });
    });
    let message: Message;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      emit({ type: 'error', error: describeApiError(error) });
      return;
    }
    const u = message.usage;
    const call = {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    };
    perCall.push(call);
    usage.input += call.input;
    usage.output += call.output;
    usage.cacheRead += call.cacheRead;
    usage.cacheWrite += call.cacheWrite;

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', error: 'Claude declined to answer this one. Try asking it another way.' });
      break;
    }
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (message.stop_reason !== 'tool_use' || toolUses.length === 0) break;
    if (message.stop_reason === 'tool_use' && toolUses.length && answer && !answer.endsWith('\n')) {
      answer += '\n\n';
      emit({ type: 'text', text: '\n\n' });
    }

    messages.push({ role: 'assistant', content: echo(message.content) });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      let result: unknown;
      if (use.name === 'show_on_board') {
        const parsed = z.object(showOnBoardShape).safeParse(use.input);
        if (parsed.success) {
          annotations = {
            arrows: parsed.data.arrows ?? [],
            highlights: parsed.data.highlights ?? [],
            lines: checkLines(req.fen, parsed.data.lines),
          };
          emit({ type: 'annotations', annotations });
          result = { shown: true, lines: annotations.lines.map((l) => l.moves.join(' ')) };
        } else {
          result = { error: `Invalid input: ${parsed.error.issues.map((i) => i.message).join('; ')}` };
        }
      } else if (use.name === 'suggest_tags') {
        const parsed = z.object(suggestTagsShape).safeParse(use.input);
        if (parsed.success) {
          suggestions = parsed.data;
          emit({ type: 'suggestions', suggestions });
          result = { shown: true };
        } else {
          result = { error: 'Invalid input.' };
        }
      } else {
        emit({ type: 'status', text: statusFor(use.name) });
        result = await runTool(use.name, use.input, deps.tools);
      }
      const isError = typeof result === 'object' && result !== null && 'error' in result;
      trace.push({ tool: use.name, input: use.input, ...(isError ? { error: String((result as { error: unknown }).error) } : {}) });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(result), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }

  const costUsd = estimateCost(model, usage);
  const messageId = recordExchange(deps.db, {
    fen: req.fen,
    mode: req.mode,
    question: req.mode === 'ask' ? (req.question ?? '') : questionFor(req),
    answer: answer.trim(),
    model,
    usage,
    trace: { tools: trace, annotations, suggestions, calls: perCall },
  });
  emit({ type: 'done', model, usage, costUsd, messageId });
}

function statusFor(tool: string): string {
  return (
    {
      evaluate: 'Asking Stockfish for the best lines…',
      compare_moves: 'Comparing moves with Stockfish…',
      play_line: 'Playing out a line…',
      position_facts: 'Looking at the structure…',
      find_threats: 'Looking for threats…',
      search_concepts: 'Searching your concepts…',
      get_repertoire: 'Checking your repertoire…',
      search_games: 'Searching your games…',
      opening_stats: 'Checking Lichess statistics…',
    }[tool] ?? `Running ${tool}…`
  );
}

export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'Anthropic did not accept the API key. Check it in Settings.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'This API key may not use that model. Pick another in Settings.';
  if (error instanceof Anthropic.RateLimitError) return 'The API is rate limiting this key. Try again in a minute.';
  if (error instanceof Anthropic.BadRequestError) return `The API rejected the request: ${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Check the internet connection.';
  if (error instanceof Anthropic.APIError) return `The Claude API answered ${error.status ?? 'with an error'}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// --- Game review: the code finds the mistakes, the coach explains them ---

/**
 * Finds the 3–5 biggest eval drops in a game's moves, by Stockfish at a
 * modest depth, then asks the coach to explain each one.
 */
export async function reviewGame(
  deps: CoachDeps,
  req: { startFen: string; moves: string[]; myColor?: 'white' | 'black' },
  emit: (event: CoachEvent) => void,
): Promise<void> {
  if (req.moves.length < 2) {
    emit({ type: 'error', error: 'There are not enough moves to review.' });
    return;
  }
  const nodes = [createGame(req.startFen).root];
  for (const san of req.moves) nodes.push(playMove(nodes.at(-1)!, san));
  const scores: number[] = [];
  const best: string[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    if (deps.signal?.aborted) return;
    if (i % 4 === 0) emit({ type: 'status', text: `Checking the game with Stockfish: move ${Math.ceil(Math.max(i, 1) / 2)} of ${Math.ceil(req.moves.length / 2)}…` });
    const analysis = await deps.tools.analyse(nodes[i]!.fen, { depth: 12, multipv: 1 });
    const line = analysis.lines[0];
    const value = line ? (line.mate !== undefined ? (line.mate > 0 ? 20 : -20) : Math.max(-20, Math.min(20, (line.cp ?? 0) / 100))) : 0;
    scores.push(value);
    best.push(line?.san[0] ?? '');
  }
  const moments: ReviewMoment[] = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const sign = isWhiteMove(node) ? 1 : -1;
    const loss = (scores[i - 1]! - scores[i]!) * sign;
    if (loss >= 0.7 && best[i - 1] !== node.san) {
      moments.push({
        ply: node.ply,
        move: moveLabel(node.ply, node.san),
        before: fmt(scores[i - 1]!),
        after: fmt(scores[i]!),
        best: moveLabel(node.ply, best[i - 1]!),
        lossInPawns: Math.round(loss * 10) / 10,
      });
    }
  }
  const top = moments
    .sort((a, b) => b.lossInPawns - a.lossInPawns)
    .slice(0, 5)
    .sort((a, b) => a.ply - b.ply);
  emit({ type: 'moments', moments: top });
  if (!top.length) {
    emit({ type: 'text', text: 'Stockfish finds no move in this game that lost more than about 0.7 pawns. A clean game!' });
    emit({ type: 'done', model: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: 0, messageId: '' });
    return;
  }
  const list = top
    .map((m) => `- ${m.move}: score ${m.before} before, ${m.after} after (Stockfish at depth 12; it preferred ${m.best}). Position before the move: ${nodes[nodes.findIndex((n) => n.ply === m.ply) - 1]!.fen}`)
    .join('\n');
  await runCoach(
    deps,
    { mode: 'review_game', fen: nodes.at(-1)!.fen, startFen: req.startFen, moves: req.moves, myColor: req.myColor },
    emit,
    `The code checked every move of this game with Stockfish and found these moments as the biggest drops (scores from White's point of view):\n${list}\n\nExplain each moment in turn: what was played, what was better and why, using compare_moves or play_line from the position before the move. Then end with two or three lessons from the game. Call show_on_board for the most important moment.`,
  );
}

function fmt(score: number): string {
  if (Math.abs(score) >= 20) return score > 0 ? 'winning for White (mate)' : 'winning for Black (mate)';
  return `${score > 0 ? '+' : ''}${score.toFixed(2)}`;
}
