import {
  type Color,
  type Game,
  addMove,
  createGame,
  getHeader,
  mainlineFrom,
  parseGame,
  writePgn,
} from '@chess/chess-core';
import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { type GameDetail, api } from './api.ts';
import { useConfirm } from './components/AskText.tsx';
import { loadText } from './loadText.ts';
import { navigate } from './router.ts';
import { readDraft, writeDraft } from './storage.ts';
import { type GameApi, useGame } from './useGame.ts';

/**
 * What every screen shares: the game on the analysis board, whether it is a
 * library game, and a way to show a message.
 */

export interface LinkedGame {
  id: string;
  label: string;
  myColor?: Color | null;
}

export interface Workspace {
  g: GameApi;
  /** The library game the board is showing, if any. */
  linked: LinkedGame | null;
  /** My colour in the linked game, when known. */
  linkedColor: Color | null;
  orientation: Color;
  setOrientation(color: Color): void;
  flip(): void;
  /** Shows a library game on the board, at a ply of its main line if given. */
  openGame(detail: GameDetail, ply?: number): Promise<void>;
  openGameById(id: string, ply?: number): Promise<void>;
  /**
   * Opens pasted PGN or FEN on the board and gives back an error message, or null. Straight away,
   * unless edits on the board have to be asked about first.
   */
  openText(text: string): string | null | Promise<string | null>;
  openFen(fen: string, orientation?: Color): Promise<void>;
  /** Opens a position with a line of moves played from it, showing the end of the line. */
  openLine(fen: string, sans: string[]): Promise<void>;
  newGame(): Promise<void>;
  /** Saves the board's game into the library (new) or back into its library game. */
  saveToLibrary(): Promise<void>;
  /** A message at the bottom; `action` adds a button to it, such as Undo after a delete. */
  toast(text: string, error?: boolean, action?: ToastAction): void;
  message: { text: string; error: boolean; action?: ToastAction } | null;
  dismissMessage(): void;
}

const Context = createContext<Workspace | null>(null);

export interface ToastAction {
  label: string;
  run(): void | Promise<void>;
}

/**
 * The toast for a delete that went to the trash, with Undo putting it back. `restore` takes the
 * items out of the trash; `then` refreshes what the screen shows.
 */
export function undoToast(ws: Pick<Workspace, 'toast'>, text: string, restore: () => Promise<unknown>, then: () => void): void {
  ws.toast(text, false, {
    label: 'Undo',
    run: async () => {
      try {
        await restore();
        then();
        ws.toast('Put back.');
      } catch (error) {
        ws.toast((error as Error).message, true);
      }
    },
  });
}

export function useWorkspace(): Workspace {
  const ws = useContext(Context);
  if (!ws) throw new Error('useWorkspace outside WorkspaceProvider');
  return ws;
}

interface Draft {
  pgn: string;
  linked: LinkedGame | null;
}

function readSavedDraft(): Draft | null {
  const raw = readDraft();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Draft;
    if (typeof parsed.pgn === 'string') return parsed;
  } catch {
    return { pgn: raw, linked: null }; // phase 1 kept the bare PGN
  }
  return null;
}

function gameLabel(game: Game): string {
  const white = getHeader(game, 'White');
  const black = getHeader(game, 'Black');
  const year = getHeader(game, 'Date')?.slice(0, 4);
  const names = [white, black].filter((n) => n && n !== '?');
  return names.length ? `${names.join(' – ')}${year && !year.includes('?') ? `, ${year}` : ''}` : 'Library game';
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const draft = useRef(readSavedDraft());
  const confirm = useConfirm();
  const linkedRef = useRef<LinkedGame | null>(draft.current?.linked ?? null);
  const g = useGame(() => {
    if (draft.current) {
      try {
        return parseGame(draft.current.pgn);
      } catch {
        // A broken draft is dropped.
      }
    }
    return createGame();
  }, { current: () => linkedRef.current, restore: (value) => setLinked((value as LinkedGame | null) ?? null) });
  const [linked, setLinked] = useState<LinkedGame | null>(draft.current?.linked ?? null);
  linkedRef.current = linked;

  /**
   * Before the board's game is replaced. A library game edited since it was opened (the header says
   * "unsaved changes") is asked about; an edited analysis goes, with a note that Ctrl+Z brings it
   * back, as on Lichess; an untouched or empty board just goes.
   */
  const edited = () => g.dirty && (g.game.root.children.length > 0 || g.game.root.comments.length > 0);
  const hasEdits = () => linked !== null && edited();
  // Written as `hasEdits() && (await discardRefused())` at each call, so with nothing to ask the board
  // changes at once, in the same tick, as it always did.
  const discardRefused = async (): Promise<boolean> =>
    !(await confirm({
      title: 'Discard the changes?',
      message: `Your changes to “${linked?.label ?? 'this game'}” are not saved in the library. Ctrl+Z brings them back afterwards.`,
      confirm: 'Discard changes',
      cancel: 'Keep editing',
    }));
  /** Call before replacing the board; returns what to say afterwards, if anything. */
  const clearedNote = () => (linked === null && edited() ? 'The previous analysis is cleared. Ctrl+Z brings it back.' : null);
  const [orientation, setOrientation] = useState<Color>('white');
  const [message, setMessage] = useState<{ text: string; error: boolean; action?: ToastAction } | null>(null);

  useEffect(() => {
    writeDraft(JSON.stringify({ pgn: writePgn(g.game), linked } satisfies Draft));
  }, [g.game, g.version, linked]);

  useEffect(() => {
    if (!message) return;
    // A message with a button (Undo) stays long enough to use it.
    const timer = setTimeout(() => setMessage(null), message.action ? 9000 : message.error ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const toast = (text: string, error = false, action?: ToastAction) => setMessage({ text, error, action });

  const openGame = async (detail: GameDetail, ply?: number) => {
    if (hasEdits() && (await discardRefused())) return;
    const note = clearedNote();
    const game = parseGame(detail.pgn);
    const at = ply === undefined ? undefined : mainlineFrom(game.root).find((n) => n.ply === ply)?.id;
    g.load(game, { at, clean: true });
    if (note) toast(note);
    setLinked({ id: detail.id, label: gameLabel(game), myColor: detail.myColor });
    setOrientation(detail.myColor === 'black' ? 'black' : 'white');
    navigate('board');
  };

  const ws: Workspace = {
    g,
    linked,
    linkedColor: linked?.myColor ?? null,
    orientation,
    setOrientation,
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
    openGame,
    openGameById: async (id, ply) => {
      try {
        await openGame(await api.game(id), ply);
      } catch (error) {
        toast((error as Error).message, true);
      }
    },
    openText: (text) => {
      const result = loadText(text);
      if ('error' in result) return result.error;
      const open = () => {
        const note = clearedNote();
        g.load(result.game, { clean: true });
        setLinked(null);
        setOrientation('white');
        if (result.note ?? note) toast((result.note ?? note)!);
        navigate('board');
        return null;
      };
      return hasEdits() ? discardRefused().then((refused) => (refused ? null : open())) : open();
    },
    openFen: async (fen, color) => {
      if (hasEdits() && (await discardRefused())) return;
      const note = clearedNote();
      g.load(createGame(fen), { clean: true });
      if (note) toast(note);
      setLinked(null);
      setOrientation(color ?? (fen.split(' ')[1] === 'b' ? 'black' : 'white'));
      navigate('board');
    },
    openLine: async (fen, sans) => {
      if (hasEdits() && (await discardRefused())) return;
      const note = clearedNote();
      const game = createGame(fen);
      let node = game.root;
      for (const san of sans) node = addMove(node, san);
      g.load(game, { at: node.id, clean: true });
      if (note) toast(note);
      setLinked(null);
      setOrientation(fen.split(' ')[1] === 'b' ? 'black' : 'white');
      navigate('board');
    },
    newGame: async () => {
      if (hasEdits() && (await discardRefused())) return;
      const note = clearedNote();
      g.load(createGame(), { clean: true });
      setLinked(null);
      if (note) toast(note);
    },
    saveToLibrary: async () => {
      try {
        const pgn = writePgn(g.game);
        if (linked) {
          await api.updateGame(linked.id, { pgn });
          toast('Saved to the library.');
        } else {
          const { id } = await api.createGame(pgn);
          setLinked({ id, label: gameLabel(g.game) });
          toast('Added to the library.');
        }
        g.markClean();
      } catch (error) {
        toast((error as Error).message, true);
      }
    },
    toast,
    dismissMessage: () => setMessage(null),
    message,
  };

  return <Context.Provider value={ws}>{children}</Context.Provider>;
}
