import {
  SUFFIX_TO_NAG,
  collapseWhitespace,
  nagToPgn,
  shapeCommands,
  splitComment,
} from './annotations.ts';
import { InvalidFenError, START_FEN, normalizeFen } from './positionKey.ts';
import {
  type Game,
  type Header,
  IllegalMoveError,
  type MoveNode,
  SEVEN_TAG_ROSTER,
  emptyNode,
  isWhiteMove,
  moveNumber,
  playMove,
  plyFromFen,
} from './tree.ts';

/**
 * PGN reading and writing with everything a study needs to survive a round
 * trip: variations at any depth, comments (including those that open a
 * variation), NAGs and their !/? suffixes, and arrows and highlights in
 * [%cal]/[%csl]. chess.js only keeps a single line of moves, so the movetext
 * parser lives here and uses chess.js for move legality alone.
 *
 * Known normalisations, none of which changes the game:
 * - whitespace inside a comment is collapsed to single spaces;
 * - a suffix like "!" and the NAG $1 are the same thing and are written as "!";
 * - a variation that repeats an existing move is merged into it;
 * - the Seven Tag Roster is written first, with "?" for missing values.
 * Not supported yet: null moves (--) and Chess960 castling.
 */

export class PgnParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`);
    this.name = 'PgnParseError';
  }
}

export interface PgnError {
  /** Which game in the text, counting from 0. */
  gameIndex: number;
  line: number;
  message: string;
}

export interface ParseResult {
  games: Game[];
  /** Games that could not be read; the others are still returned. */
  errors: PgnError[];
}

type Token =
  | { kind: 'tag'; name: string; value: string; line: number }
  | { kind: 'comment'; text: string; line: number }
  | { kind: 'open'; line: number }
  | { kind: 'close'; line: number }
  | { kind: 'nag'; nag: number; line: number }
  | { kind: 'move'; san: string; line: number }
  | { kind: 'result'; result: string; line: number };

const RESULTS: Record<string, string> = {
  '1-0': '1-0',
  '0-1': '0-1',
  '1/2-1/2': '1/2-1/2',
  '½-½': '1/2-1/2',
  '*': '*',
};

const TAG = /\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*\]/y;
const WORD_END = /[\s(){}[\];$]/;

class Lexer {
  private pos = 0;
  line = 1;
  private pending: Token[] = [];

  constructor(private readonly text: string) {}

  next(): Token | null {
    if (this.pending.length) return this.pending.shift()!;
    const { text } = this;
    while (this.pos < text.length) {
      const ch = text[this.pos]!;
      if (ch === '\n') {
        this.line += 1;
        this.pos += 1;
      } else if (/\s/.test(ch)) {
        this.pos += 1;
      } else if (ch === '%' && (this.pos === 0 || text[this.pos - 1] === '\n')) {
        this.skipLine(); // escape line
      } else if (ch === '[') {
        return this.tag();
      } else if (ch === '{') {
        return this.braceComment();
      } else if (ch === ';') {
        const start = this.pos + 1;
        this.skipLine();
        return { kind: 'comment', text: text.slice(start, this.pos), line: this.line };
      } else if (ch === '(') {
        this.pos += 1;
        return { kind: 'open', line: this.line };
      } else if (ch === ')') {
        this.pos += 1;
        return { kind: 'close', line: this.line };
      } else if (ch === '$') {
        const match = /^\$(\d+)/.exec(text.slice(this.pos, this.pos + 6));
        if (!match) throw new PgnParseError('"$" must be followed by a NAG number', this.line);
        this.pos += match[0].length;
        return { kind: 'nag', nag: Number(match[1]), line: this.line };
      } else {
        const start = this.pos;
        while (this.pos < text.length && !WORD_END.test(text[this.pos]!)) this.pos += 1;
        const tokens = this.word(text.slice(start, this.pos));
        if (tokens.length) {
          this.pending.push(...tokens.slice(1));
          return tokens[0]!;
        }
      }
    }
    return null;
  }

  /** After an error, moves on to the next line that starts a tag section. */
  skipToNextGame(): void {
    const next = this.text.indexOf('\n[', this.pos);
    this.pending = [];
    if (next === -1) {
      this.pos = this.text.length;
      return;
    }
    for (let i = this.pos; i <= next; i += 1) if (this.text[i] === '\n') this.line += 1;
    this.pos = next + 1;
  }

  private skipLine(): void {
    const end = this.text.indexOf('\n', this.pos);
    this.pos = end === -1 ? this.text.length : end;
  }

  private tag(): Token {
    TAG.lastIndex = this.pos;
    const match = TAG.exec(this.text);
    if (!match) throw new PgnParseError('Malformed tag; expected [Name "value"]', this.line);
    this.pos = TAG.lastIndex;
    const value = match[2]!.replace(/\\(["\\])/g, '$1');
    return { kind: 'tag', name: match[1]!, value, line: this.line };
  }

  private braceComment(): Token {
    const line = this.line;
    const end = this.text.indexOf('}', this.pos);
    if (end === -1) throw new PgnParseError('A comment opened with "{" is never closed', line);
    const body = this.text.slice(this.pos + 1, end);
    this.line += body.split('\n').length - 1;
    this.pos = end + 1;
    return { kind: 'comment', text: body, line };
  }

  /** Classifies one word of movetext: move numbers, results, moves and their suffixes. */
  private word(raw: string): Token[] {
    const line = this.line;
    const result = RESULTS[raw];
    if (result) return [{ kind: 'result', result, line }];
    const numbered = /^(\d+)(\.+)(.*)$/.exec(raw);
    if (numbered) return numbered[3] ? this.word(numbered[3]) : [];
    if (/^\d+$/.test(raw) || raw === 'e.p.') return [];
    if (/^[!?]+$/.test(raw)) {
      const nag = SUFFIX_TO_NAG[raw];
      return nag ? [{ kind: 'nag', nag, line }] : [];
    }
    if (raw === '--' || raw === 'Z0') {
      throw new PgnParseError('Null moves (--) are not supported yet', line);
    }
    const parts = /^(.*?)[+#]*([!?]*)[+#]*$/.exec(raw)!;
    const tokens: Token[] = [{ kind: 'move', san: parts[1]!, line }];
    const nag = parts[2] ? SUFFIX_TO_NAG[parts[2]] : undefined;
    if (nag) tokens.push({ kind: 'nag', nag, line });
    return tokens;
  }
}

/** Reads every game in a PGN text. Games that fail are reported and skipped. */
export function parsePgn(text: string): ParseResult {
  const lexer = new Lexer(text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'));
  const games: Game[] = [];
  const errors: PgnError[] = [];
  let chunk: Token[] = [];
  let sawMovetext = false;

  const flush = () => {
    if (chunk.length) {
      const gameIndex = games.length + errors.length;
      try {
        games.push(buildGame(chunk));
      } catch (error) {
        errors.push(toPgnError(error, gameIndex, chunk[0]?.line ?? lexer.line));
      }
    }
    chunk = [];
    sawMovetext = false;
  };

  for (;;) {
    let token: Token | null;
    try {
      token = lexer.next();
    } catch (error) {
      errors.push(toPgnError(error, games.length + errors.length, lexer.line));
      chunk = [];
      sawMovetext = false;
      lexer.skipToNextGame();
      continue;
    }
    if (!token) break;
    if (token.kind === 'tag' && sawMovetext) flush();
    chunk.push(token);
    if (token.kind !== 'tag') sawMovetext = true;
    if (token.kind === 'result') flush();
  }
  flush();
  return { games, errors };
}

/** Reads the first game of a PGN text, or throws the reason it cannot. */
export function parseGame(text: string): Game {
  const { games, errors } = parsePgn(text);
  const first = errors[0];
  if (first && first.gameIndex === 0) throw new PgnParseError(first.message, first.line);
  const game = games[0];
  if (!game) throw new PgnParseError('No game found', 1);
  return game;
}

function toPgnError(error: unknown, gameIndex: number, line: number): PgnError {
  if (error instanceof PgnParseError) {
    return { gameIndex, line: error.line, message: error.message.replace(/^Line \d+: /, '') };
  }
  return { gameIndex, line, message: error instanceof Error ? error.message : String(error) };
}

interface Frame {
  /** Where this line starts. */
  start: MoveNode;
  /** The position the next move is played from. */
  pos: MoveNode;
  /** The position before the last move of this line, where a variation branches off. */
  before: MoveNode | null;
  /** Comments read before this line's first move. */
  pending: string[];
  /** Whether this line created `pos` (rather than reaching it through a merged duplicate move). */
  ownsPos: boolean;
}

function buildGame(tokens: Token[]): Game {
  const headers: Header[] = [];
  for (const token of tokens) {
    if (token.kind === 'tag') headers.push({ name: token.name, value: token.value });
  }

  const fenHeader = headers.find((h) => h.name === 'FEN')?.value;
  let startFen = START_FEN;
  if (fenHeader) {
    try {
      startFen = normalizeFen(fenHeader);
    } catch (error) {
      const line = tokens.find((t) => t.kind === 'tag' && t.name === 'FEN')?.line ?? 1;
      throw new PgnParseError(`The FEN tag is not a valid position (${(error as InvalidFenError).message})`, line);
    }
  }

  const root = emptyNode({ ply: plyFromFen(startFen), san: '', uci: '', fen: startFen });
  const stack: Frame[] = [];
  let frame: Frame = { start: root, pos: root, before: null, pending: [], ownsPos: true };
  let result: string | undefined;

  for (const token of tokens) {
    switch (token.kind) {
      case 'tag':
        break;
      case 'move': {
        let played: MoveNode;
        try {
          played = playMove(frame.pos, token.san);
        } catch (error) {
          if (!(error instanceof IllegalMoveError)) throw error;
          const ply = frame.pos.ply + 1;
          const label = `${Math.ceil(ply / 2)}${ply % 2 === 1 ? '.' : '...'} ${token.san}`;
          throw new PgnParseError(`${label} is not a legal move here`, token.line);
        }
        // A variation that repeats an existing move is merged into it. A line
        // continuing from a position it created goes first there, even if a
        // merged variation already hung its own continuation on it.
        let node = frame.pos.children.find((c) => c.uci === played.uci);
        const merged = node !== undefined;
        if (!node) {
          node = played;
          if (frame.ownsPos) frame.pos.children.unshift(node);
          else frame.pos.children.push(node);
        }
        if (frame.pending.length) {
          node.startingComments.push(...frame.pending);
          frame.pending = [];
        }
        frame.before = frame.pos;
        frame.pos = node;
        frame.ownsPos = !merged;
        break;
      }
      case 'comment': {
        const { text, arrows, highlights } = splitComment(token.text);
        const onMove = frame.pos !== frame.start || stack.length === 0;
        if (onMove) {
          if (text) frame.pos.comments.push(text);
          frame.pos.arrows.push(...arrows);
          frame.pos.highlights.push(...highlights);
        } else if (text) {
          frame.pending.push(text);
        }
        break;
      }
      case 'nag':
        if ((frame.pos !== frame.start || stack.length === 0) && !frame.pos.nags.includes(token.nag)) {
          frame.pos.nags.push(token.nag);
        }
        break;
      case 'open':
        if (!frame.before) throw new PgnParseError('A variation "(" must follow a move', token.line);
        stack.push(frame);
        frame = { start: frame.before, pos: frame.before, before: null, pending: [], ownsPos: false };
        break;
      case 'close': {
        const outer = stack.pop();
        if (!outer) throw new PgnParseError('")" closes a variation that was never opened', token.line);
        frame = outer;
        break;
      }
      case 'result':
        result = token.result;
        break;
    }
  }
  // An unclosed variation at the end of the text is closed silently.

  const resultHeader = headers.find((h) => h.name === 'Result')?.value;
  return { headers, root, result: result ?? (resultHeader ? RESULTS[resultHeader] : undefined) ?? '*' };
}

export interface WriteOptions {
  /** Wrap movetext at this many characters; 0 writes it on one line. Default 80. */
  lineLength?: number;
}

/** Writes one game as PGN: tags, a blank line, movetext, a trailing newline. */
export function writePgn(game: Game, options: WriteOptions = {}): string {
  const lineLength = options.lineLength ?? 80;
  return `${writeHeaders(game)}\n\n${wrap(movetext(game), lineLength)}\n`;
}

/** Writes several games, separated by blank lines. */
export function writePgnGames(games: Game[], options: WriteOptions = {}): string {
  return games.map((g) => writePgn(g, options)).join('\n');
}

function writeHeaders(game: Game): string {
  const byName = new Map(game.headers.map((h) => [h.name, h.value]));
  const lines: string[] = [];
  for (const name of SEVEN_TAG_ROSTER) {
    let value = byName.get(name) ?? (name === 'Date' ? '????.??.??' : '?');
    if (name === 'Result') value = game.result;
    lines.push(tagLine(name, value));
  }
  for (const h of game.headers) {
    if (!(SEVEN_TAG_ROSTER as readonly string[]).includes(h.name)) lines.push(tagLine(h.name, h.value));
  }
  return lines.join('\n');
}

function tagLine(name: string, value: string): string {
  return `[${name} "${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

function commentTokens(texts: string[], node?: Pick<MoveNode, 'arrows' | 'highlights'>): string[] {
  const clean = texts.map((t) => collapseWhitespace(t).replace(/}/g, ')')).filter(Boolean);
  const shapes = node ? shapeCommands(node.arrows, node.highlights) : '';
  if (shapes) {
    if (clean.length) clean[0] = `${shapes} ${clean[0]}`;
    else clean.push(shapes);
  }
  return clean.map((t) => `{ ${t} }`);
}

/** Writes one move; returns whether a following Black move needs its number again. */
function writeMove(node: MoveNode, forceNumber: boolean, out: string[]): boolean {
  const starting = commentTokens(node.startingComments);
  out.push(...starting);
  if (isWhiteMove(node)) out.push(`${moveNumber(node)}.`);
  else if (forceNumber || starting.length) out.push(`${moveNumber(node)}...`);
  const suffix = node.nags.find((n) => n >= 1 && n <= 6);
  out.push(node.san + (suffix ? nagToPgn(suffix) : ''));
  for (const nag of node.nags) if (nag !== suffix) out.push(`$${nag}`);
  const comments = commentTokens(node.comments, node);
  out.push(...comments);
  return comments.length > 0;
}

/** Writes the line after a node: its main continuation, each move followed by its alternatives. */
function writeLine(from: MoveNode, forceNumber: boolean, out: string[]): void {
  let pos = from;
  let force = forceNumber;
  while (pos.children.length) {
    const [main, ...variations] = pos.children as [MoveNode, ...MoveNode[]];
    force = writeMove(main, force, out);
    for (const variation of variations) {
      out.push('(');
      writeLine(variation, writeMove(variation, true, out), out);
      out.push(')');
    }
    if (variations.length) force = true;
    pos = main;
  }
}

function movetext(game: Game): string {
  const out: string[] = commentTokens(game.root.comments, game.root);
  for (const nag of game.root.nags) out.push(`$${nag}`);
  writeLine(game.root, true, out);
  out.push(game.result);
  // No space inside variation parentheses: "(1... c5 2. Nf3)".
  let text = '';
  out.forEach((token, i) => {
    const glue = i === 0 || out[i - 1] === '(' || token === ')' ? '' : ' ';
    text += glue + token;
  });
  return text;
}

/** Greedy wrap at spaces. A word starting with "%" never begins a line, where it would be an escape. */
function wrap(text: string, lineLength: number): string {
  if (lineLength <= 0) return text;
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    if (current && current.length + 1 + word.length > lineLength && !word.startsWith('%')) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}
