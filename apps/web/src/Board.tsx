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
  castleTarget,
  isPromotion,
} from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';
import { pieceImage } from './pieces.ts';

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
  /** The mouse wheel over the board: -1 a move back (wheel up), 1 a move on (wheel down), as on Lichess. */
  onWheelStep?(direction: -1 | 1): void;
}

/** How far the wheel turns for one move: about one notch of a mouse wheel, many small trackpad scrolls. */
const WHEEL_NOTCH = 50;

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

export function Board({ node, orientation, autoShapes = [], viewOnly = false, onMove, onShapes, onWheelStep }: BoardProps) {
  const element = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const wheelStep = useRef(onWheelStep);
  wheelStep.current = onWheelStep;
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
            // A king put on its own rook castles: the move is the king's two-square step.
            const to = castleTarget(at.fen, orig, dest) ?? dest;
            if (isPromotion(at.fen, orig, to)) setPromotion({ from: orig, to });
            else handlers.current.onMove(orig, to);
          },
        },
      },
      drawable: {
        enabled: true,
        visible: true,
        // Arrows and circles are part of the game's notes: clicking a piece must not wipe them
        // (chessground erases them by default, which suits a board without saved drawings).
        eraseOnMovablePieceClick: false,
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

  // The wheel steps through the moves; the page does not scroll under it. Not passive, so that it can
  // stop the scroll. A line or page of scrolling (Firefox's wheel) is a notch; pixels add up to one.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let pending = 0;
    const onWheel = (event: WheelEvent) => {
      if (!wheelStep.current || !event.deltaY) return;
      event.preventDefault();
      const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * WHEEL_NOTCH;
      if (Math.sign(delta) !== Math.sign(pending)) pending = 0;
      pending += delta;
      if (Math.abs(pending) < WHEEL_NOTCH) return;
      wheelStep.current(pending > 0 ? 1 : -1);
      pending = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const choosePromotion = (piece: string | null) => {
    const pending = promotion;
    setPromotion(null);
    if (pending && piece) onMove(pending.from, pending.to, piece);
    else api.current?.set({ fen: boardState(node.fen).placement }); // cancelled: undo the drag
  };

  return (
    <div ref={frame} className="board-frame relative select-none">
      <div ref={element} className="h-full w-full" data-testid="board" />
      {promotion && (
        <PromotionPicker color={boardState(node.fen).turn} square={promotion.to} orientation={orientation} onChoose={choosePromotion} />
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

/** The pieces to promote to, in a column over the promotion square, as on Lichess. */
function PromotionPicker({
  color,
  square,
  orientation,
  onChoose,
}: {
  color: Color;
  square: string;
  orientation: Color;
  onChoose(piece: string | null): void;
}) {
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

  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = orientation === 'white' ? file : 7 - file;
  const top = orientation === 'white' ? 7 - rank : rank;
  // From the edge the pawn reached, towards the middle.
  const rowOf = (i: number) => (top === 0 ? i : 7 - i);

  return (
    <div className="absolute inset-0 z-10 bg-black/40" onClick={() => onChoose(null)}>
      <div role="dialog" aria-label="Promote to" onClick={(e) => e.stopPropagation()}>
        {PIECES.map((p, i) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChoose(p.key)}
            className="absolute rounded-full bg-surface bg-center bg-no-repeat shadow-panel hover:bg-accent-soft"
            style={{
              left: `${column * 12.5}%`,
              top: `${rowOf(i) * 12.5}%`,
              width: '12.5%',
              height: '12.5%',
              backgroundImage: `url("${pieceImage(color === 'white' ? p.key.toUpperCase() : p.key)}")`,
              backgroundSize: '80%',
            }}
            title={`${p.name} (${p.key.toUpperCase()})`}
            aria-label={p.name}
          />
        ))}
      </div>
    </div>
  );
}
