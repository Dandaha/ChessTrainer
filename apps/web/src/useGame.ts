import {
  type Arrow,
  type Game,
  type Header,
  type Highlight,
  type MoveInput,
  type MoveNode,
  addMove,
  createGame,
  deleteNode,
  findNode,
  mainlineFrom,
  makeMainline,
  parentOf,
  pathTo,
  promoteVariation,
  toggleNag,
} from '@chess/chess-core';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

/**
 * The game on the board and where we are in it. The tree is edited in place;
 * `version` goes up after every edit so React re-renders.
 */

interface Snapshot {
  game: Game;
  currentId: string;
  context?: unknown;
}

export interface GameApi {
  game: Game;
  current: MoveNode;
  /** Root to current node. */
  path: MoveNode[];
  version: number;
  canUndo: boolean;
  /** Edited since it was loaded or last marked clean. */
  dirty: boolean;
  markClean(): void;
  goTo(id: string): void;
  back(): void;
  forward(): void;
  /** At a branch point: which continuation → follows (0 is the main line). */
  choice: number;
  /** Picks another continuation at a branch point: +1 the next one down, -1 the one above. */
  choose(step: 1 | -1): void;
  toStart(): void;
  toEnd(): void;
  /** Plays a line of moves from a node (not necessarily the current one) and shows its end. */
  playLineFrom(id: string, sans: string[]): void;
  /** Plays a move from the current position. Returns false if it is illegal. */
  play(move: MoveInput): boolean;
  deleteFrom(id: string): void;
  promote(id: string): void;
  makeMain(id: string): void;
  setCommentText(text: string): void;
  toggleNag(nag: number): void;
  /** The game's result (1-0, 0-1, 1/2-1/2 or *), as written in the PGN. */
  setResult(result: string): void;
  /** Replaces the game's header tags. */
  setHeaders(headers: Header[]): void;
  setShapes(arrows: Arrow[], highlights: Highlight[]): void;
  /** Loads a game; `at` picks the node to show, `clean` marks it as saved. */
  load(game: Game, options?: { at?: string; clean?: boolean }): void;
  undo(): void;
}

/**
 * `context` is stored with each undo step and handed back on undo: the workspace keeps which library
 * game was open there, so undoing a New brings back the game and its link, not a copy.
 */
export function useGame(
  initial: () => Game = () => createGame(),
  context?: { current: () => unknown; restore: (value: unknown) => void },
): GameApi {
  const [game, setGame] = useState<Game>(initial);
  const [currentId, setCurrentId] = useState(() => game.root.id);
  // Which continuation → follows at a branch point; back to the main line on every new position.
  const [choice, setChoice] = useState(0);
  useEffect(() => setChoice(0), [currentId]);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [cleanVersion, setCleanVersion] = useState(-1);
  const undoStack = useRef<Snapshot[]>([]);
  const contextRef = useRef(context);
  contextRef.current = context;

  const current = findNode(game.root, currentId) ?? game.root;
  const path = pathTo(game.root, current.id);

  /**
   * Remembers the game before each change, so Ctrl+Z takes back the last one, whatever it was: a move,
   * a delete, a comment. (Undoing only deletes would bring back a deleted line over the moves played
   * since, and lose them.)
   */
  const snapshot = useCallback(() => {
    undoStack.current.push({ game: structuredClone(game), currentId, context: contextRef.current?.current() });
    if (undoStack.current.length > 100) undoStack.current.shift();
  }, [game, currentId]);
  // Typing a comment is one change per move, not one per key.
  const commentEdit = useRef<{ id: string; at: number } | null>(null);

  const goTo = useCallback((id: string) => setCurrentId(id), []);

  return {
    game,
    current,
    path,
    version,
    canUndo: undoStack.current.length > 0,
    dirty: version !== cleanVersion,
    markClean: () => setCleanVersion(version),
    goTo,
    back: () => {
      const parent = parentOf(game.root, current.id);
      if (parent) setCurrentId(parent.id);
    },
    forward: () => {
      const next = current.children[Math.min(choice, current.children.length - 1)] ?? current.children[0];
      if (next) setCurrentId(next.id);
    },
    choice: Math.min(choice, Math.max(0, current.children.length - 1)),
    choose: (step) => {
      const n = current.children.length;
      if (n > 1) setChoice((c) => (((Math.min(c, n - 1) + step) % n) + n) % n);
    },
    toStart: () => setCurrentId(game.root.id),
    toEnd: () => setCurrentId(mainlineFrom(current).at(-1)!.id),
    playLineFrom: (id, sans) => {
      let node = findNode(game.root, id);
      if (!node) return;
      snapshot();
      let added = false;
      for (const san of sans) {
        try {
          const parent = node;
          const before = parent.children.length;
          node = addMove(parent, san);
          if (parent.children.length !== before) added = true;
        } catch {
          break;
        }
      }
      setCurrentId(node.id);
      if (added) bump();
      else undoStack.current.pop(); // only went to moves already there
    },
    play: (move) => {
      snapshot();
      try {
        const before = current.children.length;
        const node = addMove(current, move);
        setCurrentId(node.id);
        // Stepping into a move that is already there is navigation, not an edit.
        if (current.children.length !== before) bump();
        else undoStack.current.pop();
        return true;
      } catch {
        undoStack.current.pop();
        return false;
      }
    },
    setResult: (result) => {
      snapshot();
      game.result = result;
      bump();
    },
    setHeaders: (headers) => {
      snapshot();
      game.headers = headers;
      bump();
    },
    deleteFrom: (id) => {
      if (id === game.root.id) return;
      snapshot();
      const onPath = pathTo(game.root, currentId).some((n) => n.id === id);
      const parent = deleteNode(game.root, id);
      if (onPath && parent) setCurrentId(parent.id);
      bump();
    },
    promote: (id) => {
      snapshot();
      promoteVariation(game.root, id);
      bump();
    },
    makeMain: (id) => {
      snapshot();
      makeMainline(game.root, id);
      bump();
    },
    setCommentText: (text) => {
      // Commands such as [%clk] stay attached, out of sight; drawings live in arrows/highlights.
      const last = commentEdit.current;
      if (!last || last.id !== current.id || Date.now() - last.at > 3000) snapshot();
      commentEdit.current = { id: current.id, at: Date.now() };
      const hidden = current.comments.join(' ').match(/\[%[^\]]*\]/g) ?? [];
      const value = [...hidden, text.trim()].join(' ').trim();
      current.comments = value ? [value] : [];
      bump();
    },
    toggleNag: (nag) => {
      if (current === game.root) return;
      snapshot();
      toggleNag(current, nag);
      bump();
    },
    setShapes: (arrows, highlights) => {
      snapshot();
      current.arrows = arrows;
      current.highlights = highlights;
      bump();
    },
    load: (next, options = {}) => {
      if (game.root.children.length || game.root.comments.length) snapshot();
      setGame(next);
      setCurrentId(options.at ?? next.root.id);
      bump();
      // load() itself is one edit; a clean load is clean after it.
      setCleanVersion(options.clean ? version + 1 : -1);
    },
    undo: () => {
      const last = undoStack.current.pop();
      if (!last) return;
      setGame(last.game);
      setCurrentId(last.currentId);
      contextRef.current?.restore(last.context);
      bump();
    },
  };
}
