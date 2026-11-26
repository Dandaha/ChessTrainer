import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import type { DrawShape } from '@lichess-org/chessground/draw';
import type { Key } from '@lichess-org/chessground/types';
import {
  type Arrow,
  type Color,
  type Highlight,
  type MoveNode,
  type ShapeColor,
  boardState,
  isPromotion,
} from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';

/**
 * The chessground board for one position. Moves and drawings go back up
 * through callbacks; the board never changes the game itself.
 *
 * Drawing: right-click drag for an arrow, right-click a square to circle it.
 * Hold Shift for red, Alt for blue, Shift+Alt for yellow.
 */

interface BoardProps {
  node: MoveNode;
  orientation: Color;
  /** Arrows drawn by the app (repertoire moves, engine lines), not saved in the game. */
  autoShapes?: DrawShape[];
  /** A board you can look at but not move on. */
  viewOnly?: boolean;
  onMove(from: string, to: string, promotion?: string): void;
  onShapes(arrows: Arrow[], highlights: Highlight[]): void;
}

const COLORS: ShapeColor[] = ['green', 'red', 'blue', 'yellow'];

function toShapes(node: MoveNode): DrawShape[] {
  return [
    ...node.highlights.map((h) => ({ orig: h.square as Key, brush: h.color })),
    ...node.arrows.map((a) => ({ orig: a.from as Key, dest: a.to as Key, brush: a.color })),
  ];
}

function fromShapes(shapes: DrawShape[]): { arrows: Arrow[]; highlights: Highlight[] } {
  const arrows: Arrow[] = [];
  const highlights: Highlight[] = [];
  for (const s of shapes) {
    const color = COLORS.find((c) => c === s.brush) ?? 'green';
    if (s.dest && s.dest !== s.orig) {
      arrows.push({ from: s.orig, to: s.dest, color } as Arrow);
    } else {
      highlights.push({ square: s.orig, color } as Highlight);
    }
  }
  return { arrows, highlights };
}

export type { DrawShape };

export function Board({ node, orientation, autoShapes = [], viewOnly = false, onMove, onShapes }: BoardProps) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  // The latest callbacks, for chessground's events, which are bound once.
  const handlers = useRef({ onMove, onShapes, node });
  handlers.current = { onMove, onShapes, node };

  useEffect(() => {
    if (!element.current) return;
    api.current = Chessground(element.current, {
      coordinates: true,
      animation: { enabled: true, duration: 160 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      draggable: { showGhost: true },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const { node: at } = handlers.current;
            if (isPromotion(at.fen, orig, dest)) setPromotion({ from: orig, to: dest });
            else handlers.current.onMove(orig, dest);
          },
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        onChange: (shapes) => {
          const { arrows, highlights } = fromShapes(shapes);
          handlers.current.onShapes(arrows, highlights);
        },
      },
    });
    return () => {
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    const state = boardState(node.fen);
    api.current?.set({
      fen: state.placement,
      orientation,
      turnColor: state.turn,
      check: state.check ? state.turn : false,
      lastMove: node.uci ? [node.uci.slice(0, 2) as Key, node.uci.slice(2, 4) as Key] : undefined,
      viewOnly,
      movable: { color: viewOnly ? undefined : state.turn, dests: state.dests as Map<Key, Key[]> },
      drawable: { shapes: toShapes(node), autoShapes },
    });
  });

  const choosePromotion = (piece: string | null) => {
    const pending = promotion;
    setPromotion(null);
    if (pending && piece) onMove(pending.from, pending.to, piece);
    else api.current?.set({ fen: boardState(node.fen).placement }); // cancelled: undo the drag
  };

  return (
    <div className="board-frame relative select-none">
      <div ref={element} className="h-full w-full" data-testid="board" />
      {promotion && (
        <PromotionPicker color={boardState(node.fen).turn} onChoose={choosePromotion} />
      )}
    </div>
  );
}

const PIECES: { key: string; name: string; white: string; black: string }[] = [
  { key: 'q', name: 'Queen', white: '♕', black: '♛' },
  { key: 'r', name: 'Rook', white: '♖', black: '♜' },
  { key: 'b', name: 'Bishop', white: '♗', black: '♝' },
  { key: 'n', name: 'Knight', white: '♘', black: '♞' },
];

function PromotionPicker({ color, onChoose }: { color: Color; onChoose(piece: string | null): void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const piece = PIECES.find((p) => p.key === event.key.toLowerCase());
      if (piece) onChoose(piece.key);
      else if (event.key === 'Escape') onChoose(null);
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onChoose]);

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
      onClick={() => onChoose(null)}
    >
      <div
        className="flex gap-2 rounded-xl bg-surface p-3 shadow-panel"
        role="dialog"
        aria-label="Promote to"
        onClick={(e) => e.stopPropagation()}
      >
        {PIECES.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChoose(p.key)}
            className="flex h-16 w-16 flex-col items-center justify-center rounded-lg text-4xl leading-none text-text hover:bg-surface-2"
            title={`${p.name} (${p.key.toUpperCase()})`}
          >
            {color === 'white' ? p.white : p.black}
            <span className="mt-1 text-[10px] text-muted">{p.key.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
