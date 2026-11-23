import { type MoveNode, NAG_GLYPHS, displayComment, isWhiteMove, moveNumber } from '@chess/chess-core';

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

export function AnnotationPanel(props: AnnotationPanelProps) {
  const { node, isRoot, onMainline } = props;
  const label = isRoot
    ? 'Starting position'
    : `${moveNumber(node)}${isWhiteMove(node) ? '.' : '…'} ${node.san}`;

  const nagButton = (nag: number) => {
    const active = node.nags.includes(nag);
    const info = NAG_GLYPHS[nag]!;
    return (
      <button
        key={nag}
        type="button"
        disabled={isRoot}
        onClick={() => props.onToggleNag(nag)}
        title={info.label}
        aria-label={info.label}
        aria-pressed={active}
        className={`min-w-8 rounded-md border px-1.5 py-0.5 text-sm font-semibold disabled:opacity-40 ${
          active
            ? 'border-accent bg-accent text-on-accent'
            : 'border-line bg-surface hover:bg-surface-2'
        }`}
      >
        {info.glyph}
      </button>
    );
  };

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
        className="w-full resize-y rounded-md border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap gap-1">{MOVE_NAGS.map(nagButton)}</div>
      <div className="flex flex-wrap gap-1">{POSITION_NAGS.map(nagButton)}</div>
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
