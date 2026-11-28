import { answerProblem, createGame, describeGameEnd, gameEnd } from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';
import { type ConceptSummary, type PositionSetSummary, type SavedPositionInput, api } from '../api.ts';
import { CategorySelect } from './CategorySelect.tsx';
import { ConceptPicker } from './ConceptPicker.tsx';
import { navigate } from '../router.ts';
import { Modal } from '../Dialogs.tsx';
import { useConfirm } from './AskText.tsx';
import { MiniBoard } from './MiniBoard.tsx';

const CASTLING: Record<string, string> = { K: 'White O-O', Q: 'White O-O-O', k: 'Black O-O', q: 'Black O-O-O' };

/**
 * Everything in a FEN besides the pieces, in words: whose move, castling, en passant, the move number
 * and the count towards the 50-move rule.
 */
export function describeSetup(fen: string): string {
  const [, turn, castling = '-', ep = '-', clock = '0', move = '1'] = fen.split(' ');
  return [
    `${turn === 'b' ? 'Black' : 'White'} to move`,
    castling === '-' ? 'no castling' : `castling: ${[...castling].map((c) => CASTLING[c]).filter(Boolean).join(', ')}`,
    ep === '-' ? null : `en passant on ${ep}`,
    `move ${move}`,
    Number(clock) > 0 ? `${clock} moves since a capture or pawn move` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Save the position on the board. Only a title is asked for; source, side to
 * move, players and event fill themselves in. Everything else is optional.
 */
export function SavePositionDialog({
  fen,
  defaults,
  onClose,
  onSaved,
  newPosition,
}: {
  fen: string;
  defaults: Pick<SavedPositionInput, 'sourceGameId' | 'sourcePly' | 'sourceLabel' | 'answer'>;
  onClose(): void;
  onSaved(title: string, id: string): void;
  /**
   * A position set up by hand (the Positions screen): the dialog shows it, opens with every field,
   * can go back to the board (`hidden` meanwhile, keeping what was typed) and may start in a set.
   */
  newPosition?: { hidden: boolean; onBack(): void; setId?: string };
}) {
  const [title, setTitle] = useState('');
  const [more, setMore] = useState(!!newPosition);
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [keyIdea, setKeyIdea] = useState('');
  const [answer, setAnswer] = useState(defaults.answer ?? '');
  const details = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [inTraining, setInTraining] = useState(false);
  const [setId, setSetId] = useState(newPosition?.setId ?? '');
  const [sets, setSets] = useState<PositionSetSummary[]>([]);
  const [concepts, setConcepts] = useState<ConceptSummary[]>([]);
  const [before, setBefore] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInput.current?.focus();
    api.savesAt(fen).then(setBefore).catch(() => {});
    api.sets().then(setSets).catch(() => {});
  }, [fen]);

  const save = async () => {
    if (!title.trim()) {
      setError('Give it a title.');
      titleInput.current?.focus();
      return;
    }
    try {
      const saved = await api.savePosition({
        fen,
        title: title.trim(),
        category: category || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        keyIdea: keyIdea.trim() || null,
        answer: answer.trim() || null,
        notesMd: notes.trim() || null,
        difficulty: difficulty ? Number(difficulty) : null,
        inTraining,
        setIds: setId ? [setId] : [],
        sourceGameId: defaults.sourceGameId ?? null,
        sourcePly: defaults.sourcePly ?? null,
        sourceLabel: defaults.sourceLabel ?? null,
      });
      await Promise.all(concepts.map((c) => api.linkConcept(c.id, 'saved_position', { targetId: saved.id })));
      onSaved(title.trim(), saved.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const field = 'w-full rounded-md border border-field bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent';
  // A position with no legal moves (mate or stalemate) can be kept, but there is nothing to solve.
  const ending = newPosition ? gameEnd([createGame(fen).root]) : null;
  const noMoves = ending && (ending.kind === 'checkmate' || ending.kind === 'stalemate') ? ending : null;

  // Closing loses what was typed (and a new position's setup): asked first, Escape and the backdrop too.
  const confirm = useConfirm();
  const typed = Boolean(title.trim() || notes.trim() || keyIdea.trim() || tags.trim() || category || concepts.length || answer.trim() !== (defaults.answer ?? '').trim());
  const close = async () => {
    if (newPosition || typed) {
      const sure = await confirm({
        title: newPosition ? 'Discard this position?' : 'Discard what you typed?',
        message: newPosition ? 'The position you set up and its details are not saved.' : 'The title and details you typed are not saved.',
        confirm: 'Discard',
        cancel: 'Keep editing',
      });
      if (!sure) return;
    }
    onClose();
  };

  // Back on the board: nothing shows, and everything typed stays for when the details come back.
  if (newPosition?.hidden) return null;

  return (
    <Modal title={newPosition ? 'New position' : 'Save position'} onClose={() => void close()}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
        {newPosition && (
          <div className="flex items-start gap-3">
            <div className="w-28 shrink-0">
              <MiniBoard fen={fen} flipped={fen.split(' ')[1] === 'b'} />
            </div>
            <div className="min-w-0 space-y-2 text-sm">
              <p data-testid="setup-summary">{describeSetup(fen)}</p>
              {noMoves && (
                <p className="text-xs text-danger">
                  {describeGameEnd(noMoves)} There is no move to find here, so solving and training will skip over it.
                </p>
              )}
              <button type="button" className="text-accent" onClick={newPosition.onBack}>
                ← Change the position
              </button>
            </div>
          </div>
        )}
        <input
          ref={titleInput}
          aria-label="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          placeholder="Title, e.g. Greek gift on h7"
          className={field}
        />
        {before.length > 0 && (
          <p className="text-sm text-muted">
            You saved this position before ({before.length}):{' '}
            {before.map((b, i) => (
              <span key={b.id}>
                {i > 0 && ', '}
                <button
                  type="button"
                  className="text-accent underline-offset-2 hover:underline"
                  onClick={() => {
                    onClose();
                    navigate(`positions?open=${b.id}`);
                  }}
                >
                  {b.title}
                </button>
              </span>
            ))}
          </p>
        )}
        {defaults.sourceLabel && <p className="text-xs text-muted">From {defaults.sourceLabel}</p>}

        {!more ? (
          <button
            type="button"
            className="text-sm text-accent"
            onClick={() => {
              setMore(true);
              // The button goes away: focus moves on to the first of the fields it opens.
              requestAnimationFrame(() => details.current?.querySelector<HTMLElement>('select, input, textarea')?.focus());
            }}
          >
            More details (optional)…
          </button>
        ) : (
          <div ref={details} className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-muted">Category</span>
              <CategorySelect value={category} onChange={setCategory} allowNew className={field} />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Difficulty</span>
              <select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className={field}>
                <option value="">Not set</option>
                {[1, 2, 3, 4, 5].map((d) => (
                  <option key={d} value={d}>
                    {'★'.repeat(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-muted">Tags, separated by commas</span>
              <input aria-label="Tags" value={tags} onChange={(e) => setTags(e.target.value)} className={field} />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-muted">Key idea (hidden in solve and present mode)</span>
              <input aria-label="Key idea" value={keyIdea} onChange={(e) => setKeyIdea(e.target.value)} className={field} />
            </label>
            <label className="space-y-1">
              <span className="text-muted">Answer: a move or a whole line</span>
              <input
                aria-label="Answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="e.g. Bxh7+ Kxh7 Ng5+ (empty: Stockfish judges)"
                className={field}
                aria-invalid={answerProblem(fen, answer) !== null}
              />
              {answerProblem(fen, answer) && <span className="block text-xs text-danger">{answerProblem(fen, answer)}</span>}
            </label>
            <label className="space-y-1">
              <span className="text-muted">Add to set</span>
              <select aria-label="Set" value={setId} onChange={(e) => setSetId(e.target.value)} className={field}>
                <option value="">None</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 space-y-1">
              <span className="text-muted">Notes (markdown)</span>
              <textarea aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={field} />
            </label>
            <div className="col-span-2 space-y-1">
              <span className="text-muted">Concepts (type a new name to create it)</span>
              <ConceptPicker
                linked={concepts}
                onAdd={(c) => setConcepts((l) => [...l, c])}
                onRemove={(c) => setConcepts((l) => l.filter((x) => x.id !== c.id))}
              />
            </div>
            <label className="col-span-2 flex items-center gap-2">
              <input type="checkbox" checked={inTraining} onChange={(e) => setInTraining(e.target.checked)} />
              Add to training
            </label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted">
            <kbd>Enter</kbd> saves
          </span>
          <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
