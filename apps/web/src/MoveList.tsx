import {
  type Game,
  type MoveNode,
  displayComment,
  getHeader,
  isWhiteMove,
  moveNumber,
  nagGlyph,
} from '@chess/chess-core';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * The moves of the game, Lichess style: the main line flows as text and each
 * variation opens as an indented block under the move it replaces.
 */

interface MoveListProps {
  game: Game;
  currentId: string;
  onSelect(id: string): void;
  onMenu(id: string, x: number, y: number): void;
}

export function MoveList({ game, currentId, onSelect, onMenu }: MoveListProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current?.querySelector<HTMLElement>('[data-current="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId]);

  const move = (node: MoveNode, showNumber: boolean): ReactNode => {
    const isCurrent = node.id === currentId;
    const number = isWhiteMove(node) ? `${moveNumber(node)}.` : `${moveNumber(node)}…`;
    return (
      <button
        key={node.id}
        type="button"
        tabIndex={-1}
        data-current={isCurrent}
        data-node={node.id}
        onClick={() => onSelect(node.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(node.id, e.clientX, e.clientY);
        }}
        className={`mx-px rounded px-1 py-0.5 font-medium tabular-nums ${
          isCurrent ? 'bg-selected text-on-selected' : 'hover:bg-surface-2'
        }`}
      >
        {showNumber && <span className={isCurrent ? 'opacity-80' : 'text-muted'}>{number}</span>}
        {node.san}
        {node.nags.length > 0 && (
          <span className={isCurrent ? '' : 'text-accent'}>{node.nags.map(nagGlyph).join('')}</span>
        )}
      </button>
    );
  };

  const comment = (key: string, texts: string[]): ReactNode => {
    const text = displayComment(texts.join(' '));
    return text ? (
      <span key={key} className="mx-1 text-comment">
        {text}
      </span>
    ) : null;
  };

  /** The line after a position: its main moves, with each move's alternatives beneath it. */
  const line = (from: MoveNode, forceFirstNumber: boolean): ReactNode[] => {
    const out: ReactNode[] = [];
    let pos = from;
    let force = forceFirstNumber;
    while (pos.children.length) {
      const [main, ...variations] = pos.children as [MoveNode, ...MoveNode[]];
      out.push(comment(`${main.id}-before`, main.startingComments));
      out.push(move(main, isWhiteMove(main) || force || main.startingComments.length > 0));
      const after = comment(`${main.id}-after`, main.comments);
      out.push(after);
      force = after !== null;
      if (variations.length) {
        out.push(
          <div key={`${main.id}-variations`}>
            {variations.map((v) => (
              <div key={v.id} className="variation">
                {comment(`${v.id}-before`, v.startingComments)}
                {move(v, true)}
                {comment(`${v.id}-after`, v.comments)}
                {line(v, v.comments.length > 0)}
              </div>
            ))}
          </div>,
        );
        force = true;
      }
      pos = main;
    }
    return out;
  };

  const white = getHeader(game, 'White');
  const black = getHeader(game, 'Black');
  const event = getHeader(game, 'Event');
  const hasPlayers = (white && white !== '?') || (black && black !== '?');

  return (
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-[15px] leading-7 [overflow-wrap:anywhere]">
      {hasPlayers && (
        <div className="mb-2 border-b border-line pb-2">
          <div className="font-semibold">
            {white || '?'} <span className="text-muted">vs</span> {black || '?'}
          </div>
          {event && event !== '?' && <div className="text-sm text-muted">{event}</div>}
        </div>
      )}
      {comment('root', game.root.comments)}
      {game.root.children.length === 0 ? (
        <p className="text-sm text-muted">
          Make a move on the board, type one below, or paste a PGN or FEN anywhere.
        </p>
      ) : (
        <div>
          {line(game.root, true)}
          {game.result !== '*' && <span className="ml-2 font-semibold text-muted">{game.result}</span>}
        </div>
      )}
    </div>
  );
}
