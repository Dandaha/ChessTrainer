import { Chessground } from '@lichess-org/chessground';
import type { Api } from '@lichess-org/chessground/api';
import { dragNewPiece } from '@lichess-org/chessground/drag';
import type { Key, Piece, Role } from '@lichess-org/chessground/types';
import { START_FEN, normalizeFen } from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '../Dialogs.tsx';
import { pieceImage } from '../pieces.ts';
import { buttonClass, inputClass, primaryClass } from './ui.tsx';

/**
 * Sets up a position by hand: drag pieces from the palette onto the board (or pick one and click
 * squares), drag a piece off the board to remove it, then say whose move it is and what castling
 * and en passant are still possible.
 */

const ROLE: Record<string, Role> = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
const PALETTE = ['K', 'Q', 'R', 'B', 'N', 'P', 'k', 'q', 'r', 'b', 'n', 'p'];
const EMPTY = '8/8/8/8/8/8/8/8';
type Tool = string | 'delete' | null;

function pieceOf(letter: string): Piece {
  return { role: ROLE[letter.toLowerCase()]!, color: letter === letter.toUpperCase() ? 'white' : 'black' };
}

/** The piece on each square of a placement field, by square name. */
function squares(placement: string): Map<string, string> {
  const out = new Map<string, string>();
  placement.split('/').forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else out.set(`${'abcdefgh'[file++]}${8 - i}`, ch);
    }
  });
  return out;
}

const RIGHTS: { right: 'K' | 'Q' | 'k' | 'q'; label: string; king: [string, string]; rook: [string, string] }[] = [
  { right: 'K', label: 'White O-O', king: ['e1', 'K'], rook: ['h1', 'R'] },
  { right: 'Q', label: 'White O-O-O', king: ['e1', 'K'], rook: ['a1', 'R'] },
  { right: 'k', label: 'Black O-O', king: ['e8', 'k'], rook: ['h8', 'r'] },
  { right: 'q', label: 'Black O-O-O', king: ['e8', 'k'], rook: ['a8', 'r'] },
];

/** Squares where an en passant capture could be on: behind a pawn that may just have moved two squares. */
function enPassantSquares(placement: string, turn: 'w' | 'b'): string[] {
  const on = squares(placement);
  const [pawn, rank, behind, start] = turn === 'w' ? ['p', 5, 6, 7] : ['P', 4, 3, 2];
  return [...'abcdefgh'].filter((f) => on.get(`${f}${rank}`) === pawn && !on.has(`${f}${behind}`) && !on.has(`${f}${start}`)).map((f) => `${f}${behind}`);
}

export function BoardEditor({ fen, onUse, onClose }: { fen: string; onUse(fen: string): void; onClose(): void }) {
  const [start] = useState(() => fen.split(' '));
  const [placement, setPlacement] = useState(start[0] ?? EMPTY);
  const [turn, setTurn] = useState<'w' | 'b'>(start[1] === 'b' ? 'b' : 'w');
  const [rights, setRights] = useState(() => new Set((start[2] ?? '-').replace('-', '').split('').filter(Boolean)));
  const [ep, setEp] = useState(start[3] ?? '-');
  // The move counters: kept from the position it started from, or from a FEN pasted in.
  const [counters, setCounters] = useState<[string, string]>([start[4] ?? '0', start[5] ?? '1']);
  const [orientation, setOrientation] = useState<'white' | 'black'>(start[1] === 'b' ? 'black' : 'white');
  const [tool, setTool] = useState<Tool>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const board = useRef<Api | null>(null);
  const toolRef = useRef<Tool>(null);
  toolRef.current = tool;

  const on = squares(placement);
  const possible = (r: (typeof RIGHTS)[number]) => on.get(r.king[0]) === r.king[1] && on.get(r.rook[0]) === r.rook[1];
  const castling = RIGHTS.filter((r) => rights.has(r.right) && possible(r))
    .map((r) => r.right)
    .join('');
  const epChoices = enPassantSquares(placement, turn);
  const result = `${placement} ${turn} ${castling || '-'} ${epChoices.includes(ep) ? ep : '-'} ${counters[0]} ${counters[1]}`;
  let problem: string | null = null;
  try {
    normalizeFen(result);
  } catch (error) {
    const why = (error as Error).message.replace(/^Invalid FEN:\s*/i, '');
    problem = `${why.charAt(0).toUpperCase()}${why.slice(1).replace(/\.?$/, '.')}`;
  }

  useEffect(() => {
    if (!element.current) return;
    const api = Chessground(element.current, {
      fen: placement,
      orientation,
      coordinates: true,
      autoCastle: false,
      movable: { free: true, color: 'both', showDests: false },
      premovable: { enabled: false },
      draggable: { showGhost: true, deleteOnDropOff: true },
      highlight: { lastMove: false, check: false },
      drawable: { enabled: false },
      events: {
        change: () => setPlacement(api.getFen()),
        select: (key) => {
          const current = toolRef.current;
          if (!current) return;
          api.setPieces(new Map([[key, current === 'delete' ? undefined : pieceOf(current)]]));
          api.selectSquare(null);
          setPlacement(api.getFen());
        },
      },
    });
    board.current = api;
    return () => api.destroy();
    // The board is made once; later changes go through set() below.
  }, []);

  useEffect(() => {
    if (board.current && board.current.getFen() !== placement) board.current.set({ fen: placement });
  }, [placement]);
  useEffect(() => board.current?.set({ orientation }), [orientation]);

  const loadTyped = (text: string) => {
    const fields = text.trim().split(/\s+/);
    if (!fields[0] || fields[0].split('/').length !== 8) return false;
    setPlacement(fields[0]);
    setTurn(fields[1] === 'b' ? 'b' : 'w');
    setRights(new Set((fields[2] ?? '-').replace('-', '').split('').filter(Boolean)));
    setEp(fields[3] ?? '-');
    setCounters([/^\d+$/.test(fields[4] ?? '') ? fields[4]! : '0', /^[1-9]\d*$/.test(fields[5] ?? '') ? fields[5]! : '1']);
    return true;
  };

  const paletteButton = (letter: string) => (
    <button
      key={letter}
      type="button"
      aria-label={`${letter === letter.toUpperCase() ? 'White' : 'Black'} ${ROLE[letter.toLowerCase()]}`}
      aria-pressed={tool === letter}
      onClick={() => setTool((t) => (t === letter ? null : letter))}
      onMouseDown={(e) => board.current && dragNewPiece(board.current.state, pieceOf(letter), e.nativeEvent)}
      onTouchStart={(e) => board.current && dragNewPiece(board.current.state, pieceOf(letter), e.nativeEvent)}
      className={`h-9 w-9 rounded-md border bg-center bg-no-repeat ${tool === letter ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2'}`}
      style={{ backgroundImage: `url("${pieceImage(letter)}")`, backgroundSize: '80%' }}
    />
  );

  return (
    <Modal title="Set up a position" onClose={onClose}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="w-full max-w-80 shrink-0 space-y-2">
          <div className="flex flex-wrap gap-0.5">{PALETTE.slice(0, 6).map(paletteButton)}</div>
          <div className="aspect-square w-full select-none">
            <div ref={element} className="h-full w-full" data-testid="editor-board" />
          </div>
          <div className="flex flex-wrap gap-0.5">
            {PALETTE.slice(6).map(paletteButton)}
            <button
              type="button"
              aria-pressed={tool === 'delete'}
              onClick={() => setTool((t) => (t === 'delete' ? null : 'delete'))}
              className={`h-9 rounded-md border px-2 text-xs ${tool === 'delete' ? 'border-accent bg-accent-soft' : 'border-transparent text-muted hover:bg-surface-2'}`}
              title="Click squares to empty them"
            >
              Remove
            </button>
          </div>
          <p className="text-xs text-muted">
            Drag pieces on, or pick one and click squares. Drag a piece off the board to remove it.
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-3 text-sm">
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">To move</legend>
            <div className="flex gap-3">
              {(['w', 'b'] as const).map((side) => (
                <label key={side} className="flex items-center gap-1.5">
                  <input type="radio" name="turn" checked={turn === side} onChange={() => setTurn(side)} />
                  {side === 'w' ? 'White' : 'Black'}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1">
            <legend className="text-xs text-muted">Castling still possible</legend>
            <div className="grid grid-cols-2 gap-1">
              {RIGHTS.map((r) => (
                <label key={r.right} className={`flex items-center gap-1.5 ${possible(r) ? '' : 'text-muted'}`}>
                  <input
                    type="checkbox"
                    disabled={!possible(r)}
                    checked={possible(r) && rights.has(r.right)}
                    onChange={(e) =>
                      setRights((now) => {
                        const next = new Set(now);
                        if (e.target.checked) next.add(r.right);
                        else next.delete(r.right);
                        return next;
                      })
                    }
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-1">
            <span className="text-xs text-muted">En passant</span>
            <select aria-label="En passant" className={`${inputClass} block`} value={epChoices.includes(ep) ? ep : '-'} onChange={(e) => setEp(e.target.value)}>
              <option value="-">None</option>
              {epChoices.map((sq) => (
                <option key={sq} value={sq}>
                  {sq}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => loadTyped(START_FEN)}>
              Starting position
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setPlacement(EMPTY);
                setCounters(['0', '1']);
              }}
            >
              Clear
            </button>
            <button type="button" className={buttonClass} onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
              Flip
            </button>
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-muted">FEN (paste one to start from it)</span>
            <input
              aria-label="Editor FEN"
              className={`${inputClass} w-full font-mono text-xs`}
              value={typed ?? result}
              onChange={(e) => setTyped(e.target.value)}
              onBlur={() => {
                if (typed !== null) loadTyped(typed);
                setTyped(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed !== null) {
                  loadTyped(typed);
                  setTyped(null);
                }
              }}
            />
          </label>
          {problem && (
            <p role="alert" className="text-xs text-danger">
              {problem}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={buttonClass} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={primaryClass} disabled={problem !== null} onClick={() => onUse(normalizeFen(result))}>
              Analyse this position
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
