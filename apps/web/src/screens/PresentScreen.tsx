import { type Game, addMove, createGame } from '@chess/chess-core';
import { useEffect, useState } from 'react';
import { type SavedPosition, api } from '../api.ts';
import { Board } from '../Board.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { navigate } from '../router.ts';
import { dialogOpen } from '../Dialogs.tsx';

/**
 * Present mode: a set full screen, one position at a time. The idea stays
 * hidden until you reveal it. Pieces can be moved to show a line; the next
 * position starts fresh.
 */
export function PresentScreen({ setId }: { setId: string }) {
  const [items, setItems] = useState<SavedPosition[] | null>(null);
  const [name, setName] = useState('');
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [game, setGame] = useState<Game | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null);

  useEffect(() => {
    api.savedPositions({ setId, limit: 5000 }).then((d) => setItems(d.positions)).catch(() => setItems([]));
    api.sets().then((sets) => setName(sets.find((s) => s.id === setId)?.name ?? '')).catch(() => {});
  }, [setId]);

  const current = items?.[index];

  useEffect(() => {
    if (!current) return;
    const g = createGame(current.fen);
    setGame(g);
    setNodeId(g.root.id);
    setRevealed(false);
  }, [current]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!items || dialogOpen()) return;
      if (event.key === 'Escape') navigate(`positions?set=${setId}`);
      else if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault();
        setIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') setIndex((i) => Math.max(i - 1, 0));
      else if (event.key === 'Enter' || event.key.toLowerCase() === 'i') setRevealed((r) => !r);
      else if (event.key.toLowerCase() === 'r' && current) {
        const g = createGame(current.fen);
        setGame(g);
        setNodeId(g.root.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, current]);

  if (!items) return <p className="p-8 text-muted">Loading…</p>;
  if (!current || !game)
    return (
      <div className="space-y-4 p-8">
        <p className="text-muted">{name ? `“${name}” has no positions to present.` : 'This set has no positions, or is not in the library.'}</p>
        <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2" onClick={() => navigate(name ? `positions?set=${setId}` : 'positions')}>
          Back
        </button>
      </div>
    );

  const node = findById(game, nodeId) ?? game.root;

  return (
    <div className="flex h-full flex-col bg-bg" data-overlay>
      <div className="flex items-center gap-4 px-6 py-3 text-sm text-muted">
        <span className="min-w-0 truncate" title={name}>
          {name}
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          className="ml-auto shrink-0 rounded-md border border-line px-2.5 py-1 hover:bg-surface-2 lg:order-last"
          onClick={() => navigate(`positions?set=${setId}`)}
        >
          Back to the set
        </button>
        <span className="hidden shrink-0 lg:inline">
          <kbd>←</kbd> <kbd>→</kbd> move between positions · <kbd>Enter</kbd> reveal · <kbd>R</kbd> reset · <kbd>Esc</kbd> leave
        </span>
      </div>
      {/* Centred when it fits, scrollable from the top when it does not (a narrow window). */}
      <div className="flex min-h-0 flex-1 flex-col items-center-safe justify-center-safe gap-8 overflow-auto px-6 pb-6 md:flex-row">
        <Board
          node={node}
          orientation={current.sideToSolve}
          onMove={(from, to, promotion) => {
            try {
              setNodeId(addMove(node, promotion ? { from, to, promotion } : { from, to }).id);
            } catch {
              setNodeId(node.id);
            }
          }}
          onShapes={(arrows, highlights) => {
            node.arrows = arrows;
            node.highlights = highlights;
          }}
        />
        {/* Narrower beside the board in a small window, so the board keeps most of the room. */}
        <div className="w-full max-w-md space-y-4 md:max-w-64 lg:max-w-md">
          <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{current.title}</h1>
          <p className="text-muted">{current.sideToSolve === 'white' ? 'White' : 'Black'} to play.</p>
          {revealed ? (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
              {current.keyIdea && <p className="text-lg">{current.keyIdea}</p>}
              {current.answer && <p className="font-semibold text-accent">{current.answer}</p>}
              {current.notesMd && <Markdown text={current.notesMd} fen={current.fen} />}
              {!current.keyIdea && !current.answer && !current.notesMd && <p className="text-muted">No idea written for this one yet.</p>}
            </div>
          ) : (
            <button type="button" onClick={() => setRevealed(true)} className="rounded-xl border border-dashed border-line px-4 py-3 text-muted hover:text-text">
              Reveal the idea (Enter)
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-30">
              ← Previous
            </button>
            <button type="button" disabled={index === items.length - 1} onClick={() => setIndex(index + 1)} className="rounded-md border border-line px-3 py-1.5 disabled:opacity-30">
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function findById(game: Game, id: string | null) {
  if (!id) return undefined;
  const stack = [game.root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return undefined;
}
