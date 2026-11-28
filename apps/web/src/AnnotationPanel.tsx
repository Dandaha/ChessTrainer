import { type MoveNode, NAG_GLYPHS, displayComment, isWhiteMove, moveNumber } from '@chess/chess-core';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * Annotations for the current move: its comment, NAGs, and what to do with
 * the variation it is in.
 */

interface AnnotationPanelProps {
  node: MoveNode;
  isRoot: boolean;
  onMainline: boolean;
  onComment(text: string): void;
  onToggleNag(nag: number): void;
  onPromote(): void;
  onMakeMain(): void;
  onDelete(): void;
}

const MOVE_NAGS = [1, 2, 3, 4, 5, 6];
const POSITION_NAGS = [10, 13, 14, 15, 16, 17, 18, 19, 146];

/** The NAG buttons: how good the move is (! ? !! ?? !? ?!), then the position (= ∞ ± …). */
export function NagButtons({
  nags,
  disabled = false,
  onToggle,
  compact = false,
}: {
  nags: readonly number[];
  disabled?: boolean;
  onToggle(nag: number): void;
  /** Small buttons in one wrapping row, the move's marks first; 'narrow' puts the position's marks
   * behind one button. */
  compact?: boolean | 'narrow';
}) {
  const nagButton = (nag: number) => {
    const active = nags.includes(nag);
    const info = NAG_GLYPHS[nag]!;
    return (
      <button
        key={nag}
        type="button"
        disabled={disabled}
        onClick={() => onToggle(nag)}
        title={info.label}
        aria-label={info.label}
        aria-pressed={active}
        className={`rounded-md border font-semibold disabled:opacity-40 ${compact ? 'h-7 min-w-7 px-1 text-xs' : 'min-w-8 px-1.5 py-0.5 text-sm'} ${
          active ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface hover:bg-surface-2'
        }`}
      >
        {info.glyph}
      </button>
    );
  };
  if (compact === 'narrow') {
    const shown = POSITION_NAGS.filter((nag) => nags.includes(nag));
    return (
      <div className="flex flex-wrap items-center gap-1">
        {MOVE_NAGS.map(nagButton)}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        <PositionMarks label={shown.length ? shown.map((n) => NAG_GLYPHS[n]!.glyph).join(' ') : '±…'}>
          <div className="flex flex-wrap gap-1">{POSITION_NAGS.map(nagButton)}</div>
        </PositionMarks>
      </div>
    );
  }
  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-1">
        {MOVE_NAGS.map(nagButton)}
        <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
        {POSITION_NAGS.map(nagButton)}
      </div>
    );
  return (
    <>
      <div className="flex flex-wrap gap-1">{MOVE_NAGS.map(nagButton)}</div>
      <div className="flex flex-wrap gap-1">{POSITION_NAGS.map(nagButton)}</div>
    </>
  );
}

export function AnnotationPanel(props: AnnotationPanelProps) {
  const { node, isRoot, onMainline } = props;
  const label = isRoot
    ? 'Starting position'
    : `${moveNumber(node)}${isWhiteMove(node) ? '.' : '…'} ${node.san}`;

  return (
    <div className="space-y-2 border-t border-line px-3 py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-semibold">{label}</span>
        {!isRoot && !onMainline && <span className="text-xs text-muted">in a variation</span>}
      </div>
      <textarea
        key={node.id}
        aria-label="Comment"
        placeholder={isRoot ? 'A comment on the whole game…' : 'A comment on this move…'}
        defaultValue={displayComment(node.comments.join(' '))}
        onChange={(e) => props.onComment(e.target.value)}
        rows={2}
        className="w-full resize-y rounded-md border border-field bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      <NagButtons nags={node.nags} disabled={isRoot} onToggle={props.onToggleNag} />
      {!isRoot && (
        <div className="flex flex-wrap gap-2 pt-1 text-sm">
          <button
            type="button"
            disabled={onMainline}
            onClick={props.onPromote}
            className="rounded-md border border-line px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
          >
            Promote variation
          </button>
          <button
            type="button"
            disabled={onMainline}
            onClick={props.onMakeMain}
            className="rounded-md border border-line px-2 py-1 hover:bg-surface-2 disabled:opacity-40"
          >
            Make main line
          </button>
          <button
            type="button"
            onClick={props.onDelete}
            className="rounded-md border border-line px-2 py-1 text-danger hover:bg-surface-2"
            title="Delete this move and everything after it (Delete). Ctrl+Z brings it back."
          >
            Delete from here
          </button>
        </div>
      )}
    </div>
  );
}

/** The position's marks (=, ±, …) behind one button showing the ones set, for a narrow panel. */
function PositionMarks({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Evaluation of the position"
        title="Evaluation of the position"
        onClick={() => setOpen((o) => !o)}
        className="h-7 min-w-9 rounded-md border border-line bg-surface px-1.5 text-xs font-semibold hover:bg-surface-2"
      >
        {label} ▾
      </button>
      {open && <div className="absolute bottom-full left-0 z-40 mb-1 w-56 rounded-lg border border-line bg-surface p-2 shadow-panel">{children}</div>}
    </div>
  );
}
