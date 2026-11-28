import { collapseWhitespace, shapeCommands } from './annotations.ts';
import type { Color } from './board.ts';
import { START_FEN, normalizeFen, positionKey } from './positionKey.ts';
import { type Game, type MoveNode, addMove, createGame, isWhiteMove, moveNumber, playMove, plyFromFen, setComment } from './tree.ts';

/**
 * A repertoire is a graph, not a tree: each move is an edge from one position
 * to the next. A position reached by two move orders is one node, so a note or
 * a main-line choice made there shows up in every line that transposes into it.
 */

export type Priority = 'must' | 'nice';

export interface RepEdge {
  id: string;
  fromKey: string;
  toKey: string;
  san: string;
  uci: string;
  isMyMove: boolean;
  isMain: boolean;
  priority: Priority;
  comment: string | null;
  nags: number[];
}

/** A move to add, as found in a game tree or on the board. */
export interface NewEdge {
  fromFen: string;
  toFen: string;
  san: string;
  uci: string;
  isMyMove: boolean;
  isMain: boolean;
  comment: string | null;
  nags: number[];
  /** "nice" for a move marked nice to know; must when not given. */
  priority?: Priority;
}

/** The notes repertoireToGame writes into comments, read back on import rather than kept as text. */
const NICE_NOTE = '(nice to know)';
const TRANSPOSITION_NOTE = 'Transposes to a line given elsewhere.';

/**
 * A move's comment for the repertoire, from everything PGN may hold about it: comments before and
 * after the move, and its arrows and circles (kept as their [%cal]/[%csl] commands). The notes an
 * export writes for itself become the "nice to know" mark again, or are dropped.
 */
function importedComment(texts: string[], node: MoveNode): { comment: string | null; priority?: Priority } {
  let text = texts.join(' ');
  const nice = text.includes(NICE_NOTE);
  text = text.split(NICE_NOTE).join(' ').split(TRANSPOSITION_NOTE).join(' ');
  const comment = [collapseWhitespace(text), shapeCommands(node.arrows, node.highlights)].filter(Boolean).join(' ');
  return { comment: comment || null, ...(nice ? { priority: 'nice' as const } : {}) };
}

/** Edges by the position they leave, main line first. */
export function edgesByFrom(edges: RepEdge[]): Map<string, RepEdge[]> {
  const map = new Map<string, RepEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge.fromKey) ?? [];
    list.push(edge);
    map.set(edge.fromKey, list);
  }
  for (const list of map.values()) list.sort((a, b) => Number(b.isMain) - Number(a.isMain));
  return map;
}

/** Whether the side to move in a FEN is the repertoire's side. */
export function isMyTurn(fen: string, color: Color): boolean {
  return (fen.split(' ')[1] === 'w') === (color === 'white');
}

/** Every move of a game tree (variations included) as a repertoire edge for one colour. */
export function edgesFromGame(game: Game, color: Color): NewEdge[] {
  const out: NewEdge[] = [];
  const visit = (parent: MoveNode) => {
    parent.children.forEach((child, i) => {
      // The game's opening comment (before move 1) goes with the first move of the main line.
      const intro = parent === game.root && i === 0 ? game.root.comments : [];
      out.push({
        fromFen: parent.fen,
        toFen: child.fen,
        san: child.san,
        uci: child.uci,
        isMyMove: isWhiteMove(child) === (color === 'white'),
        isMain: i === 0,
        ...importedComment([...intro, ...child.startingComments, ...child.comments], child),
        nags: child.nags,
      });
      visit(child);
    });
  };
  visit(game.root);
  return out;
}

export interface RepTreeNode {
  edge: RepEdge;
  /** Full FEN after the move. */
  fen: string;
  ply: number;
  children: RepTreeNode[];
  /** Set when the position after this move was already shown higher up: the line continues there. */
  transposition: boolean;
}

/**
 * The repertoire as a tree for the explorer, from the starting position.
 * A position reached a second time is not expanded again; it is marked as a
 * transposition instead, so the tree stays finite and nothing is repeated.
 */
export function repertoireTree(edges: RepEdge[], startFen: string = START_FEN): RepTreeNode[] {
  const byFrom = edgesByFrom(edges);
  const startKey = positionKey(startFen);
  const seen = new Set<string>([startKey]);
  const halfmove = Number(normalizeFen(startFen).split(' ')[4]) || 0;

  // Breadth first, so the shortest move order to a position is the one expanded. Each move already
  // knows the position it leads to, so a node's FEN is that key and the move counters, with no need
  // to play the move again (on a repertoire of thousands of moves that took seconds).
  const roots: RepTreeNode[] = [];
  const queue: { key: string; ply: number; halfmove: number; into: RepTreeNode[] }[] = [
    { key: startKey, ply: plyFromFen(startFen), halfmove, into: roots },
  ];
  for (let i = 0; i < queue.length; i += 1) {
    const { key, ply, halfmove: clock, into } = queue[i]!;
    for (const edge of byFrom.get(key) ?? []) {
      // The 50-move clock starts again after a pawn move (SAN starting with a file) or a capture.
      const nextClock = /^[a-h]|x/.test(edge.san) ? 0 : clock + 1;
      const fen = `${edge.toKey} ${nextClock} ${Math.floor((ply + 1) / 2) + 1}`;
      const transposition = seen.has(edge.toKey);
      const node: RepTreeNode = { edge, fen, ply: ply + 1, children: [], transposition };
      into.push(node);
      if (!transposition) {
        seen.add(edge.toKey);
        queue.push({ key: edge.toKey, ply: ply + 1, halfmove: nextClock, into: node.children });
      }
    }
  }
  return roots;
}

/** The repertoire as one PGN game with variations. Transpositions get a comment and stop there. */
export function repertoireToGame(edges: RepEdge[], startFen: string = START_FEN): Game {
  const game = createGame(startFen);
  const copy = (nodes: RepTreeNode[], into: MoveNode) => {
    for (const n of nodes) {
      const child = addMove(into, n.edge.san);
      child.nags = [...n.edge.nags];
      const notes = [n.edge.comment, n.edge.priority === 'must' ? null : '(nice to know)', n.transposition ? 'Transposes to a line given elsewhere.' : null]
        .filter(Boolean)
        .join(' ');
      if (notes) setComment(child, notes);
      copy(n.children, child);
    }
  };
  copy(repertoireTree(edges, startFen), game.root);
  return game;
}

export type RepertoireCheck =
  /** The game followed the repertoire to its end. */
  | { kind: 'followed'; plies: number }
  /** I played a move the repertoire does not have. */
  | { kind: 'i-left'; ply: number; played: string; prepared: string[] }
  /** The opponent played a move the repertoire does not cover. */
  | { kind: 'opponent-left'; ply: number; played: string; prepared: string[] }
  /** The game started from a position the repertoire never reaches. */
  | { kind: 'not-in-repertoire' };

/**
 * Walks a game's main line through a repertoire and finds where it left it.
 * `ply` is the ply of the move that left (1 = White's first move).
 */
export function checkGame(game: Game, edges: RepEdge[], color: Color): RepertoireCheck {
  const byFrom = edgesByFrom(edges);
  let node = game.root;
  if (!byFrom.has(positionKey(node.fen))) return { kind: 'not-in-repertoire' };
  let plies = 0;
  while (node.children[0]) {
    const next = node.children[0];
    const prepared = byFrom.get(positionKey(node.fen)) ?? [];
    if (!prepared.length) return { kind: 'followed', plies };
    if (!prepared.some((e) => e.uci === next.uci)) {
      const mine = isWhiteMove(next) === (color === 'white');
      return { kind: mine ? 'i-left' : 'opponent-left', ply: next.ply, played: next.san, prepared: prepared.map((e) => e.san) };
    }
    node = next;
    plies += 1;
  }
  return { kind: 'followed', plies };
}

/** "9...Nd7" for a move at a ply. */
export function moveLabel(ply: number, san: string): string {
  const number = moveNumber({ ply } as MoveNode);
  return ply % 2 === 1 ? `${number}.${san}` : `${number}...${san}`;
}

/** A sentence for a check result, e.g. "You left your preparation on move 9 with ...Nd7; your line is ...Bd6". */
export function describeCheck(result: RepertoireCheck): string {
  switch (result.kind) {
    case 'not-in-repertoire':
      return 'This game does not start from a position in this repertoire.';
    case 'followed':
      return result.plies === 0
        ? 'The repertoire has nothing here yet.'
        : `The game stayed in your preparation for all ${result.plies} prepared moves.`;
    case 'i-left': {
      const n = Math.ceil(result.ply / 2);
      const dots = result.ply % 2 === 1 ? '' : '...';
      return `You left your preparation on move ${n} with ${dots}${result.played}; your line is ${result.prepared.map((s) => dots + s).join(' or ')}.`;
    }
    case 'opponent-left': {
      const n = Math.ceil(result.ply / 2);
      const dots = result.ply % 2 === 1 ? '' : '...';
      return `Your opponent left your preparation on move ${n} with ${dots}${result.played}; you prepared ${result.prepared.map((s) => dots + s).join(', ')}.`;
    }
  }
}

/** Positions in the repertoire where the opponent is to move, nearest first: the places gaps can be. */
export function opponentPositions(edges: RepEdge[], color: Color, startFen: string = START_FEN): { fen: string; ply: number }[] {
  const out: { fen: string; ply: number }[] = [];
  if (!isMyTurn(startFen, color)) out.push({ fen: startFen, ply: 0 });
  const walk = (nodes: RepTreeNode[]) => {
    for (const n of nodes) {
      if (!n.transposition && !isMyTurn(n.fen, color)) out.push({ fen: n.fen, ply: n.ply });
    }
    for (const n of nodes) if (!n.transposition) walk(n.children);
  };
  walk(repertoireTree(edges, startFen));
  return out.sort((a, b) => a.ply - b.ply);
}

/** Edges no longer reachable from the start, e.g. after deleting a move higher up. */
export function unreachableEdges(edges: RepEdge[], startFen: string = START_FEN): RepEdge[] {
  const reachable = new Set<string>();
  const byFrom = edgesByFrom(edges);
  const stack = [positionKey(startFen)];
  const seen = new Set(stack);
  while (stack.length) {
    const key = stack.pop()!;
    for (const edge of byFrom.get(key) ?? []) {
      reachable.add(edge.id);
      if (!seen.has(edge.toKey)) {
        seen.add(edge.toKey);
        stack.push(edge.toKey);
      }
    }
  }
  return edges.filter((e) => !reachable.has(e.id));
}
