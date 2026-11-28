import { useEffect, useRef, useState } from 'react';
import type { ConceptLevel, ConceptSummary, PositionCategory } from '../api.ts';
import { Menu, type MenuItem } from '../components/BoardControls.tsx';
import { useCategoryActions } from '../components/CategorySelect.tsx';
import { Icon } from '../components/icons.tsx';
import { LEVELS, LEVEL_NAMES, LevelMark, levelRank } from '../components/Level.tsx';
import { inputClass } from '../components/ui.tsx';
import { readPref, writePref } from '../storage.ts';

/**
 * The concepts as one list of folding groups, by category or by level: each group a row with its
 * count, closed until opened, and the open concept's group opened for it. A search opens every group
 * with a match. How it is grouped and sorted, and which groups are open, are kept for next time.
 */

type Grouping = 'category' | 'level';
type SortBy = 'az' | 'level' | 'recent';

const SORT_NAMES: Record<SortBy, string> = { az: 'A–Z', level: 'Easiest first', recent: 'Recently edited' };

interface View {
  group: Grouping;
  sort: SortBy;
  /** The open groups of each grouping, by key. */
  open: Record<Grouping, string[]>;
}

const VIEW_KEY = 'concepts-view';

function readView(): View {
  const stored = readPref(VIEW_KEY) as Partial<View> | undefined;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return {
    group: stored?.group === 'level' ? 'level' : 'category',
    sort: stored?.sort === 'level' || stored?.sort === 'recent' ? stored.sort : 'az',
    open: { category: strings(stored?.open?.category), level: strings(stored?.open?.level) },
  };
}

interface Group {
  /** The category's name or the level; '' for the concepts with neither. */
  key: string;
  label: string;
  items: ConceptSummary[];
  /** A category of the person's own list: it can be renamed or removed from its row. */
  category?: PositionCategory;
}

export function ConceptsSidebar({
  list,
  categories,
  q,
  onSearch,
  error,
  currentId,
  onChanged,
}: {
  list: ConceptSummary[] | null;
  categories: PositionCategory[];
  q: string;
  onSearch(q: string): void;
  error: string | null;
  currentId: string | undefined;
  /** Categories were added, renamed or removed: read them and the concepts again. */
  onChanged(): void;
}) {
  const [view, setView] = useState(readView);
  const change = (next: Partial<View>) =>
    setView((v) => {
      const merged = { ...v, ...next };
      writePref(VIEW_KEY, merged);
      return merged;
    });
  const { group } = view;
  // Easiest first means nothing inside a level's own group.
  const sort: SortBy = group === 'level' && view.sort === 'level' ? 'az' : view.sort;
  const openKeys = view.open[group];
  const setOpen = (keys: string[]) => change({ open: { ...view.open, [group]: [...new Set(keys)] } });

  const actions = useCategoryActions('concept');
  const searching = q.trim() !== '';
  const concepts = list ?? [];

  const groups: Group[] =
    group === 'category'
      ? [
          ...categories.map((c) => ({ key: c.name, label: c.name, category: c, items: concepts.filter((x) => x.category === c.name) })),
          // A name the list does not hold yet (a concept saved meanwhile).
          ...[...new Set(concepts.map((c) => c.category).filter((n): n is string => !!n && !categories.some((c) => c.name === n)))].map((name) => ({
            key: name,
            label: name,
            items: concepts.filter((c) => c.category === name),
          })),
          { key: '', label: 'Not categorised', items: concepts.filter((c) => !c.category) },
        ]
      : [
          ...LEVELS.map((level) => ({ key: level, label: LEVEL_NAMES[level], items: concepts.filter((c) => c.level === level) })),
          { key: '', label: 'No level', items: concepts.filter((c) => !c.level) },
        ];
  // Every category shows, empty or not, so a new one can be found; levels and the leftovers only when used.
  const shown = groups.filter((g) => g.items.length || (!searching && g.category));

  const sorted = (items: ConceptSummary[]) => {
    // The server's order is A–Z as people read it; the sorts below are stable, so it stays inside ties.
    if (sort === 'recent') return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sort === 'level') return [...items].sort((a, b) => levelRank(a.level) - levelRank(b.level));
    return items;
  };

  const isOpen = (g: Group) => searching || openKeys.includes(g.key);
  const allOpen = shown.length > 0 && shown.every(isOpen);

  // The concept on the page: its group opens (once per concept, so it can be closed again) and its row
  // scrolls into sight, e.g. after Ctrl+K or a related concept's link.
  const currentGroup = currentId ? shown.find((g) => g.items.some((c) => c.id === currentId))?.key : undefined;
  useEffect(() => {
    if (currentGroup !== undefined && !openKeys.includes(currentGroup)) setOpen([...openKeys, currentGroup]);
    // Only when the concept or the grouping changes, not when a group is closed.
  }, [currentId, currentGroup]);
  const activeRow = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId, currentGroup]);

  const sortItems: MenuItem[] = (Object.keys(SORT_NAMES) as SortBy[])
    .filter((s) => !(group === 'level' && s === 'level'))
    .map((s) => ({ label: SORT_NAMES[s], checked: sort === s, onSelect: () => change({ sort: s }) }));

  return (
    <aside aria-label="Concepts" className="w-64 shrink-0 space-y-3 overflow-y-auto border-r border-line p-3">
      <input aria-label="Search concepts" className={`${inputClass} w-full`} placeholder="Search, aliases too…" value={q} onChange={(e) => onSearch(e.target.value)} />
      <div className="flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Group by" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5 text-xs">
          {(['category', 'level'] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={group === g}
              onClick={() => change({ group: g })}
              className={`rounded-md px-2.5 py-1 transition-colors ${group === g ? 'bg-surface font-medium text-text shadow-sm' : 'text-muted hover:text-text'}`}
            >
              {g === 'category' ? 'Categories' : 'Levels'}
            </button>
          ))}
        </div>
        <Menu
          label={`Sort: ${SORT_NAMES[sort]}`}
          heading="Sort concepts"
          items={sortItems}
          triggerClassName="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted hover:bg-surface-2 hover:text-text aria-expanded:bg-surface-2 aria-expanded:text-text"
          trigger={
            <>
              {SORT_NAMES[sort]}
              <Icon name="down" size={13} />
            </>
          }
        />
      </div>
      {error && <p className="text-sm text-muted">{error}</p>}

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 pr-1 pl-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">{group === 'category' ? 'Categories' : 'Levels'}</span>
          <div className="flex items-center gap-1">
            {group === 'category' && (
              <button
                type="button"
                className="rounded-md px-1 text-xs font-medium text-accent hover:underline"
                aria-label="New category"
                title="A new category"
                onClick={() =>
                  void actions.add().then((created) => {
                    if (!created) return;
                    setOpen([...openKeys, created.name]);
                    onChanged();
                  })
                }
              >
                + New
              </button>
            )}
            {!searching && shown.length > 0 && (
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
                aria-label={allOpen ? 'Collapse all' : 'Expand all'}
                title={allOpen ? 'Collapse all' : 'Expand all'}
                onClick={() => setOpen(allOpen ? [] : shown.map((g) => g.key))}
              >
                <Icon name={allOpen ? 'fold' : 'unfold'} size={15} />
              </button>
            )}
          </div>
        </div>

        {list && list.length === 0 && (
          <p className="px-2 text-sm text-muted">{searching ? 'Nothing found.' : 'Your chess wiki is empty. “Add missing starter concepts” above brings back the classics.'}</p>
        )}

        <ul className="space-y-px">
          {shown.map((g) => {
            const open = isOpen(g);
            const panel = `concept-group-${group}-${g.key || 'none'}`;
            const holdsCurrent = g.key === currentGroup;
            return (
              <li key={`${group}:${g.key}`}>
                <div className="group/row flex items-center rounded-md hover:bg-surface-2">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={open ? panel : undefined}
                    disabled={searching}
                    onClick={() => setOpen(open ? openKeys.filter((k) => k !== g.key) : [...openKeys, g.key])}
                    className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1.5 text-left text-sm disabled:cursor-default ${holdsCurrent || open ? 'text-text' : 'text-muted hover:text-text'}`}
                  >
                    <Icon
                      name="next"
                      size={14}
                      className={`text-muted transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
                    />
                    {group === 'level' && g.key && <LevelMark level={g.key as ConceptLevel} className={open ? 'text-accent' : ''} />}
                    <span className={`min-w-0 flex-1 truncate ${holdsCurrent ? 'font-semibold' : 'font-medium'}`}>{g.label}</span>
                  </button>
                  {g.category && !searching && (
                    <Menu
                      label={`Category options: ${g.label}`}
                      triggerClassName="grid h-6 w-6 place-items-center rounded-md text-muted opacity-0 group-hover/row:opacity-100 hover:bg-surface hover:text-text focus-visible:opacity-100 aria-expanded:opacity-100"
                      trigger={<Icon name="more" size={15} />}
                      items={[
                        {
                          label: 'Rename…',
                          onSelect: () =>
                            void actions.rename(g.category!).then((renamed) => {
                              if (!renamed) return;
                              setOpen(openKeys.map((k) => (k === g.key ? renamed.name : k)));
                              onChanged();
                            }),
                        },
                        {
                          label: 'Remove category…',
                          danger: true,
                          onSelect: () =>
                            void actions.remove(g.category!).then((removed) => {
                              if (removed) onChanged();
                            }),
                        },
                      ]}
                    />
                  )}
                  <span className="w-8 shrink-0 pr-2 text-right text-xs tabular-nums text-muted">{g.items.length}</span>
                </div>
                {open && (
                  <div id={panel} className="fold-in">
                    {g.items.length ? (
                      <ul className="mt-px mb-1.5 ml-[13px] space-y-px border-l border-line pl-1.5">
                        {sorted(g.items).map((c) => {
                          const active = c.id === currentId;
                          return (
                            <li key={c.id}>
                              <a
                                ref={active ? activeRow : undefined}
                                href={`#/concepts/${c.id}`}
                                aria-current={active ? 'page' : undefined}
                                className={`flex items-center gap-2 rounded-md px-2 py-1 text-sm ${active ? 'bg-accent-soft font-semibold' : 'hover:bg-surface-2'}`}
                              >
                                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                                {group === 'category' && c.level && <LevelMark level={c.level} className={active ? 'text-accent' : 'text-muted'} />}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mb-1.5 ml-[13px] border-l border-line py-1 pl-3.5 text-xs text-muted">No concepts here yet.</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
