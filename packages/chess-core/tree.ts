import { Chess, type Square } from 'chess.js';
import { START_FEN, normalizeFen } from './positionKey.ts';

/**
 * A game as a tree of moves. The root stands for the starting position; each
 * node is a move and the position after it. A node's first child is the main
 * continuation and the others are variations, in order.
 *
 * The tree is mutable: the board edits it in place and re-renders. Node ids
 * are local to one loaded game and never stored; the database stores PGN.
 */

export type ShapeColor = 'green' | 'red' | 'yellow' | 'blue';

export interface Arrow {
  from: Square;
  to: Square;
  color: ShapeColor;
}

export interface Highlight {
  square: Square;
  color: ShapeColor;
}

export interface MoveNode {
  id: string;
  /** Half-moves played since the standard start; the root carries the FEN's count. */
  ply: number;
  /** SAN of the move; empty on the root. */
  san: string;
  /** The move as from-square, to-square and promotion piece (e2e4, e7e8q); empty on the root. */
  uci: string;
  /** Full FEN of the position after the move; the starting position on the root. */
  fen: string;
  nags: number[];
  /** Comments after the move. On the root: comments before the first move. */
  comments: string[];
  /** Comments before the move, which PGN allows at the start of a variation. */
  startingComments: string[];
  arrows: Arrow[];
  highlights: Highlight[];
  children: MoveNode[];
}

export interface Header {
  name: string;
  value: string;
}

export interface Game {
  headers: Header[];
  root: MoveNode;
  /** The game termination marker: 1-0, 0-1, 1/2-1/2 or *. */
  result: string;
}

let nextId = 0;
export function newNodeId(): string {
  nextId += 1;
  return `n${nextId}`;
}

export function emptyNode(fields: Pick<MoveNode, 'ply' | 'san' | 'uci' | 'fen'>): MoveNode {
  return {
    id: newNodeId(),
    ...fields,
    nags: [],
    comments: [],
    startingComments: [],
    arrows: [],
    highlights: [],
    children: [],
  };
}

/** The ply count a FEN's side to move and fullmove number imply. */
export function plyFromFen(fen: string): number {
  const fields = fen.trim().split(/\s+/);
  const fullmove = Math.max(1, Number(fields[5] ?? '1') || 1);
  return (fullmove - 1) * 2 + (fields[1] === 'b' ? 1 : 0);
}

/** Whether a move node was played by White (its ply is odd). */
export function isWhiteMove(node: MoveNode): boolean {
  return node.ply % 2 === 1;
}

/** The move number shown in front of a move node. */
export function moveNumber(node: MoveNode): number {
  return Math.ceil(node.ply / 2);
}

export const SEVEN_TAG_ROSTER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'] as const;

/** A new, empty game from the standard start or from a FEN. */
export function createGame(fen: string = START_FEN): Game {
  const start = normalizeFen(fen);
  const headers: Header[] = SEVEN_TAG_ROSTER.map((name) => ({
    name,
    value: name === 'Date' ? '????.??.??' : name === 'Result' ? '*' : '?',
  }));
  if (start !== START_FEN) {
    headers.push({ name: 'SetUp', value: '1' }, { name: 'FEN', value: start });
  }
  return { headers, root: emptyNode({ ply: plyFromFen(start), san: '', uci: '', fen: start }), result: '*' };
}

export function getHeader(game: Game, name: string): string | undefined {
  return game.headers.find((h) => h.name === name)?.value;
}

export function setHeader(game: Game, name: string, value: string): void {
  const existing = game.headers.find((h) => h.name === name);
  if (existing) existing.value = value;
  else game.headers.push({ name, value });
}

/** A move as typed (SAN) or as dragged on the board. */
export type MoveInput = string | { from: string; to: string; promotion?: string };

export class IllegalMoveError extends Error {
  constructor(
    readonly move: string,
    readonly fen: string,
  ) {
    super(`Illegal move ${move} in position ${fen}`);
    this.name = 'IllegalMoveError';
  }
}

/** Accepts SAN spellings chess.js does not: zeros in castling, "e.p.", "P" for pawns. */
function cleanSan(san: string): string {
  return san
    .replace(/^0-0-0/, 'O-O-O')
    .replace(/^0-0/, 'O-O')
    .replace(/e\.p\.$/, '')
    .replace(/^P(?=[a-h])/, '');
}

/** Plays a move from a node's position without changing the tree. Throws IllegalMoveError. */
export function playMove(from: MoveNode, input: MoveInput): MoveNode {
  const chess = new Chess(from.fen);
  const label = typeof input === 'string' ? input : `${input.from}${input.to}${input.promotion ?? ''}`;
  let move;
  try {
    move = chess.move(typeof input === 'string' ? cleanSan(input) : input);
  } catch {
    throw new IllegalMoveError(label, from.fen);
  }
  return emptyNode({ ply: from.ply + 1, san: move.san, uci: move.lan, fen: move.after });
}

/**
 * playMove for many moves in a row, as when reading a game: one board follows the line and is set up
 * again only when the next move starts somewhere else (a variation).
 */
export class MovePlayer {
  private readonly chess = new Chess();
  private at: MoveNode | null = null;

  play(from: MoveNode, san: string): MoveNode {
    if (this.at !== from) this.chess.load(from.fen, { skipValidation: true });
    let move;
    try {
      move = this.chess.move(cleanSan(san));
    } catch {
      this.at = from;
      throw new IllegalMoveError(san, from.fen);
    }
    const node = emptyNode({ ply: from.ply + 1, san: move.san, uci: move.lan, fen: move.after });
    this.at = node;
    return node;
  }

  /** The line went on from `node` (the same position as the move just played, already in the tree). */
  continueFrom(node: MoveNode): void {
    this.at = node;
  }
}

/**
 * Adds a move after a node. If that move is already there, the existing node
 * is returned, so replaying a known line never duplicates it. A new move
 * becomes the main continuation when the node has none, a variation otherwise.
 */
export function addMove(parent: MoveNode, input: MoveInput): MoveNode {
  const candidate = playMove(parent, input);
  const existing = parent.children.find((c) => c.uci === candidate.uci);
  if (existing) return existing;
  parent.children.push(candidate);
  return candidate;
}

/** Nodes from the root to the node with this id, both included; empty if absent. */
export function pathTo(root: MoveNode, id: string): MoveNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    const rest = pathTo(child, id);
    if (rest.length) return [root, ...rest];
  }
  return [];
}

export function findNode(root: MoveNode, id: string): MoveNode | undefined {
  return pathTo(root, id).at(-1);
}

export function parentOf(root: MoveNode, id: string): MoveNode | undefined {
  const path = pathTo(root, id);
  return path.length >= 2 ? path[path.length - 2] : undefined;
}

/** The node and its main continuation to the end, following first children. */
export function mainlineFrom(node: MoveNode): MoveNode[] {
  const line = [node];
  let current = node;
  while (current.children[0]) {
    current = current.children[0];
    line.push(current);
  }
  return line;
}

/** Whether every move from the root to this node is a main continuation. */
export function isOnMainline(root: MoveNode, id: string): boolean {
  const path = pathTo(root, id);
  return path.length > 0 && path.every((node, i) => i === 0 || path[i - 1]!.children[0] === node);
}

/**
 * Removes a node and everything after it. Returns the parent, where the board
 * should go next, or undefined for the root, which cannot be deleted.
 */
export function deleteNode(root: MoveNode, id: string): MoveNode | undefined {
  const parent = parentOf(root, id);
  if (!parent) return undefined;
  parent.children = parent.children.filter((c) => c.id !== id);
  return parent;
}

/**
 * Promotes the variation a node is in by one level: the nearest branch point
 * on the way back to the root where this line is not the main continuation
 * swaps it to the front. Returns false when the node is already on the main line.
 */
export function promoteVariation(root: MoveNode, id: string): boolean {
  const path = pathTo(root, id);
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const parent = path[i - 1]!;
    const node = path[i]!;
    const index = parent.children.indexOf(node);
    if (index > 0) {
      parent.children.splice(index, 1);
      parent.children.unshift(node);
      return true;
    }
  }
  return false;
}

/** Promotes a node's line until it is the main line. */
export function makeMainline(root: MoveNode, id: string): void {
  while (promoteVariation(root, id)) {
    // keep promoting
  }
}

/** Replaces a node's comment with one text; an empty text removes it. */
export function setComment(node: MoveNode, text: string): void {
  const trimmed = text.trim();
  node.comments = trimmed ? [trimmed] : [];
}

/**
 * NAGs that exclude each other: a move gets one assessment (!, ?, !!, ??, !?, ?!)
 * and a position one evaluation (=, unclear, +=, =+, +-, -+ ...).
 */
const NAG_GROUPS: number[][] = [
  [1, 2, 3, 4, 5, 6],
  [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
];

/** Turns a NAG on or off; turning one on replaces any other from its group. */
export function toggleNag(node: MoveNode, nag: number): void {
  node.nags = toggledNags(node.nags, nag);
}

/** NAGs with one turned on or off; turning one on drops the others of its kind (one of ! ? !! ?? !? ?!). */
export function toggledNags(nags: readonly number[], nag: number): number[] {
  if (nags.includes(nag)) return nags.filter((n) => n !== nag);
  const group = NAG_GROUPS.find((g) => g.includes(nag));
  return [...nags.filter((n) => !group?.includes(n)), nag].sort((a, b) => a - b);
}

/** Every node in the tree, depth first, the root included. */
export function allNodes(root: MoveNode): MoveNode[] {
  const out: MoveNode[] = [];
  const visit = (node: MoveNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}
