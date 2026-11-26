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
}

export interface Workspace {
  g: GameApi;
  /** The library game the board is showing, if any. */
  linked: LinkedGame | null;
  orientation: Color;
  setOrientation(color: Color): void;
  flip(): void;
  /** Shows a library game on the board, at a ply of its main line if given. */
  openGame(detail: GameDetail, ply?: number): void;
  openGameById(id: string, ply?: number): Promise<void>;
  /** Opens pasted PGN or FEN on the board; returns an error message or null. */
  openText(text: string): string | null;
  openFen(fen: string, orientation?: Color): void;
  /** Opens a position with a line of moves played from it, showing the end of the line. */
  openLine(fen: string, sans: string[]): void;
  newGame(): void;
  /** Saves the board's game into the library (new) or back into its library game. */
  saveToLibrary(): Promise<void>;
  toast(text: string, error?: boolean): void;
  message: { text: string; error: boolean } | null;
}

const Context = createContext<Workspace | null>(null);

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
  const g = useGame(() => {
    if (draft.current) {
      try {
        return parseGame(draft.current.pgn);
      } catch {
        // A broken draft is dropped.
      }
    }
    return createGame();
  });
  const [linked, setLinked] = useState<LinkedGame | null>(draft.current?.linked ?? null);
  const [orientation, setOrientation] = useState<Color>('white');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    writeDraft(JSON.stringify({ pgn: writePgn(g.game), linked } satisfies Draft));
  }, [g.game, g.version, linked]);

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), message.error ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [message]);

  const toast = (text: string, error = false) => setMessage({ text, error });

  const openGame = (detail: GameDetail, ply?: number) => {
    const game = parseGame(detail.pgn);
    const at = ply === undefined ? undefined : mainlineFrom(game.root).find((n) => n.ply === ply)?.id;
    g.load(game, { at, clean: true });
    setLinked({ id: detail.id, label: gameLabel(game) });
    setOrientation(detail.myColor === 'black' ? 'black' : 'white');
    navigate('board');
  };

  const ws: Workspace = {
    g,
    linked,
    orientation,
    setOrientation,
    flip: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
    openGame,
    openGameById: async (id, ply) => {
      try {
        openGame(await api.game(id), ply);
      } catch (error) {
        toast((error as Error).message, true);
      }
    },
    openText: (text) => {
      const result = loadText(text);
      if ('error' in result) return result.error;
      g.load(result.game);
      setLinked(null);
      setOrientation('white');
      if (result.note) toast(result.note);
      navigate('board');
      return null;
    },
    openFen: (fen, color) => {
      g.load(createGame(fen));
      setLinked(null);
      setOrientation(color ?? (fen.split(' ')[1] === 'b' ? 'black' : 'white'));
      navigate('board');
    },
    openLine: (fen, sans) => {
      const game = createGame(fen);
      let node = game.root;
      for (const san of sans) node = addMove(node, san);
      g.load(game, { at: node.id });
      setLinked(null);
      setOrientation(fen.split(' ')[1] === 'b' ? 'black' : 'white');
      navigate('board');
    },
    newGame: () => {
      g.load(createGame());
      setLinked(null);
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
    message,
  };

  return <Context.Provider value={ws}>{children}</Context.Provider>;
}
