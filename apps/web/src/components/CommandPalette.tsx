import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { navigate } from '../router.ts';
import { useWorkspace } from '../workspace.tsx';
import { useDialog } from '../Dialogs.tsx';

interface Item {
  key: string;
  label: string;
  hint: string;
  run(): void;
}

/** Ctrl+K: jump to a screen, a game or a saved position by typing. */
export function CommandPalette({
  screens,
  onClose,
}: {
  screens: { id: string; label: string }[];
  onClose(): void;
}) {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [found, setFound] = useState<Item[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);

  useEffect(() => input.current?.focus(), []);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      Promise.all([
        api.games({ q, limit: 6 }).catch(() => ({ games: [] })),
        api.savedPositions({ q, limit: 6 }).catch(() => ({ positions: [] })),
        searchExtra(q),
      ]).then(([g, p, extra]) => {
        if (!live) return;
        setFound([
          ...g.games.map((game) => ({
            key: `g${game.id}`,
            label: `${game.white ?? '?'} – ${game.black ?? '?'}`,
            hint: ['Game', game.result, game.date?.slice(0, 4)].filter(Boolean).join(' · '),
            run: () => void ws.openGameById(game.id),
          })),
          ...p.positions.map((pos) => ({
            key: `p${pos.id}`,
            label: pos.title,
            hint: 'Saved position',
            run: () => navigate(`positions?open=${pos.id}`),
          })),
          ...extra,
        ]);
      });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text]);

  const q = text.trim().toLowerCase();
  const items: Item[] = [
    ...screens
      .filter((s) => !q || s.label.toLowerCase().includes(q))
      .map((s) => ({ key: `s${s.id}`, label: s.label, hint: 'Screen', run: () => navigate(s.id) })),
    ...found,
  ];

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose} data-overlay>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={input}
          aria-label="Search"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
            if (e.key === 'Enter') choose(items[active]);
          }}
          placeholder="Go to a screen, a game (player, event, opening) or a saved position…"
          className="w-full border-b border-line bg-surface px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={`flex w-full items-baseline justify-between gap-4 px-4 py-2 text-left text-sm ${
                  i === active ? 'bg-accent-soft' : ''
                }`}
              >
                <span>{item.label}</span>
                <span className="text-xs text-muted">{item.hint}</span>
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-4 py-3 text-sm text-muted">Nothing found.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Later phases (concepts, repertoires) add their own results here. */
export const paletteSources: ((q: string) => Promise<Item[]>)[] = [];

async function searchExtra(q: string): Promise<Item[]> {
  const lists = await Promise.all(paletteSources.map((source) => source(q).catch(() => [])));
  return lists.flat();
}
