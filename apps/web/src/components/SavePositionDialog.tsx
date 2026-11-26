import { useEffect, useRef, useState } from 'react';
import { type PositionSetSummary, type SavedPositionInput, api } from '../api.ts';
import { navigate } from '../router.ts';
import { Modal } from '../Dialogs.tsx';

export const CATEGORIES = ['tactic', 'strategy', 'endgame', 'opening', 'calculation', 'defense'] as const;

/**
 * Save the position on the board. Only a title is asked for; source, side to
 * move, players and event fill themselves in. Everything else is optional.
 */
export function SavePositionDialog({
  fen,
  defaults,
  onClose,
  onSaved,
}: {
  fen: string;
  defaults: Pick<SavedPositionInput, 'sourceGameId' | 'sourcePly' | 'sourceLabel' | 'answer'>;
  onClose(): void;
  onSaved(title: string): void;
}) {
  const [title, setTitle] = useState('');
  const [more, setMore] = useState(false);
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [keyIdea, setKeyIdea] = useState('');
  const [answer, setAnswer] = useState(defaults.answer ?? '');
  const [notes, setNotes] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [inTraining, setInTraining] = useState(false);
  const [setId, setSetId] = useState('');
  const [sets, setSets] = useState<PositionSetSummary[]>([]);
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
      await api.savePosition({
        fen,
        title: title.trim(),
        category: (category || null) as SavedPositionInput['category'],
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
      onSaved(title.trim());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const field = 'w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent';

  return (
    <Modal title="Save position" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        className="space-y-3"
      >
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
          <button type="button" className="text-sm text-accent" onClick={() => setMore(true)}>
            More details (optional)…
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="space-y-1">
              <span className="text-muted">Category</span>
              <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
                <option value="">None</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c[0]!.toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
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
              <span className="text-muted">Answer (SAN)</span>
              <input aria-label="Answer" value={answer} onChange={(e) => setAnswer(e.target.value)} className={field} />
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
