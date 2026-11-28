import { useEffect, useId, useRef, useState } from 'react';
import { type ConceptSummary, api } from '../api.ts';
import { navigate } from '../router.ts';
import { inputClass } from './ui.tsx';

/**
 * Chips for linked concepts, with a search box to add more. Typing a name
 * that does not exist offers to create the concept on the spot, with just
 * its title; it can be written up later.
 */
export function ConceptPicker({
  linked,
  onAdd,
  onRemove,
  placeholder = 'Link a concept…',
}: {
  linked: ConceptSummary[];
  onAdd(concept: ConceptSummary): void | Promise<void>;
  onRemove?(concept: ConceptSummary): void | Promise<void>;
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [options, setOptions] = useState<ConceptSummary[]>([]);
  const [open, setOpen] = useState(false);
  // The highlighted row, which Enter takes: the first suggestion unless the arrow keys moved it.
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .concepts({ q: text.trim() || undefined })
        .then((list) => live && setOptions(list.filter((c) => !linked.some((l) => l.id === c.id)).slice(0, 8)))
        .catch(() => {});
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, open, linked]);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  // A concept is already there when the text is its title or one of its aliases.
  const typed = text.trim().toLowerCase();
  const exact = options.some((o) => o.title.toLowerCase() === typed || o.aliases.some((a) => a.toLowerCase() === typed));
  const canCreate = Boolean(text.trim()) && !exact;
  const rows = options.length + (canCreate ? 1 : 0);
  const create = () => void api.createConcept({ title: text.trim() }).then(choose);

  const choose = async (concept: ConceptSummary) => {
    setText('');
    setOpen(false);
    await onAdd(concept);
  };

  return (
    <div ref={box} className="relative space-y-1">
      {linked.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {linked.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs">
              <button type="button" className="hover:underline" onClick={() => navigate(`concepts/${c.id}`)}>
                {c.title}
              </button>
              {onRemove && (
                <button type="button" aria-label={`Unlink ${c.title}`} className="text-muted hover:text-danger" onClick={() => void onRemove(c)}>
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      <input
        aria-label="Link a concept"
        value={text}
        onFocus={() => setOpen(true)}
        role="combobox"
        aria-expanded={open && rows > 0}
        aria-controls={listId}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'ArrowDown' && rows) {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, rows - 1));
          }
          if (e.key === 'ArrowUp' && rows) {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const option = options[Math.min(active, rows - 1)];
            if (option && active < options.length) void choose(option);
            else if (canCreate) create();
          }
        }}
        placeholder={placeholder}
        className={`${inputClass} w-full`}
      />
      {open && (options.length > 0 || text.trim()) && (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-surface py-1 text-sm shadow-panel">
          {options.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`w-full px-3 py-1 text-left hover:bg-surface-2 ${i === active ? 'bg-surface-2' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => void choose(o)}
              >
                {o.title}
                {o.aliases.length > 0 && <span className="text-xs text-muted"> · {o.aliases.join(', ')}</span>}
              </button>
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={active === options.length}>
              <button
                type="button"
                className={`w-full px-3 py-1 text-left text-accent hover:bg-surface-2 ${active === options.length ? 'bg-surface-2' : ''}`}
                onMouseEnter={() => setActive(options.length)}
                onClick={create}
              >
                + Create “{text.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Concepts linked to one item, loaded and kept in step with the picker. */
export function LinkedConcepts({
  targetType,
  targetId,
}: {
  targetType: 'saved_position' | 'game' | 'repertoire_move';
  targetId: string;
}) {
  const [linked, setLinked] = useState<ConceptSummary[]>([]);
  useEffect(() => {
    api.conceptsFor(targetType, targetId).then(setLinked).catch(() => {});
  }, [targetType, targetId]);
  return (
    <ConceptPicker
      linked={linked}
      onAdd={async (c) => {
        await api.linkConcept(c.id, targetType, { targetId });
        setLinked((l) => [...l, c]);
      }}
      onRemove={async (c) => {
        await api.unlinkConcept(c.id, targetType, targetId);
        setLinked((l) => l.filter((x) => x.id !== c.id));
      }}
    />
  );
}
