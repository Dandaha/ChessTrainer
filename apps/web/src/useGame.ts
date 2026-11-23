import {
  type Arrow,
  type Game,
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
import { useCallback, useReducer, useRef, useState } from 'react';

/**
 * The game on the board and where we are in it. The tree is edited in place;
 * `version` goes up after every edit so React re-renders.
 */

interface Snapshot {
  game: Game;
  currentId: string;
}

export interface GameApi {
  game: Game;
  current: MoveNode;
  /** Root to current node. */
  path: MoveNode[];
  version: number;
  canUndo: boolean;
  goTo(id: string): void;
  back(): void;
  forward(): void;
  toStart(): void;
  toEnd(): void;
  /** Plays a move from the current position. Returns false if it is illegal. */
  play(move: MoveInput): boolean;
  deleteFrom(id: string): void;
  promote(id: string): void;
  makeMain(id: string): void;
  setCommentText(text: string): void;
  toggleNag(nag: number): void;
  setShapes(arrows: Arrow[], highlights: Highlight[]): void;
  load(game: Game): void;
  undo(): void;
}

export function useGame(initial: () => Game = () => createGame()): GameApi {
  const [game, setGame] = useState<Game>(initial);
  const [currentId, setCurrentId] = useState(() => game.root.id);
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const undoStack = useRef<Snapshot[]>([]);

  const current = findNode(game.root, currentId) ?? game.root;
  const path = pathTo(game.root, current.id);

  /** Remembers the game before a change that loses work, so Ctrl+Z can bring it back. */
  const snapshot = useCallback(() => {
    undoStack.current.push({ game: structuredClone(game), currentId });
    if (undoStack.current.length > 50) undoStack.current.shift();
  }, [game, currentId]);

  const goTo = useCallback((id: string) => setCurrentId(id), []);

  return {
    game,
    current,
    path,
    version,
    canUndo: undoStack.current.length > 0,
    goTo,
    back: () => {
      const parent = parentOf(game.root, current.id);
      if (parent) setCurrentId(parent.id);
    },
    forward: () => {
      const next = current.children[0];
      if (next) setCurrentId(next.id);
    },
    toStart: () => setCurrentId(game.root.id),
    toEnd: () => setCurrentId(mainlineFrom(current).at(-1)!.id),
    play: (move) => {
      try {
        const node = addMove(current, move);
        setCurrentId(node.id);
        bump();
        return true;
      } catch {
        return false;
      }
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
      const hidden = current.comments.join(' ').match(/\[%[^\]]*\]/g) ?? [];
      const value = [...hidden, text.trim()].join(' ').trim();
      current.comments = value ? [value] : [];
      bump();
    },
    toggleNag: (nag) => {
      if (current === game.root) return;
      toggleNag(current, nag);
      bump();
    },
    setShapes: (arrows, highlights) => {
      current.arrows = arrows;
      current.highlights = highlights;
      bump();
    },
    load: (next) => {
      if (game.root.children.length || game.root.comments.length) snapshot();
      setGame(next);
      setCurrentId(next.root.id);
      bump();
    },
    undo: () => {
      const last = undoStack.current.pop();
      if (!last) return;
      setGame(last.game);
      setCurrentId(last.currentId);
      bump();
    },
  };
}
