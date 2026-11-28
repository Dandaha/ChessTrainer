import { useEffect, useState } from 'react';
import { type PositionCategory, api } from '../api.ts';
import { useWorkspace } from '../workspace.tsx';
import { useAskText, useConfirm } from './AskText.tsx';
import { SideHeading, SideList } from './ui.tsx';

/**
 * The person's own categories, one list for saved positions and one for concepts: a picker for an
 * item's category ("New category…" adds one), and the side list that filters by them and renames or
 * removes them.
 */

export type CategoryKind = 'position' | 'concept';

const CALLS = {
  position: {
    list: api.positionCategories,
    create: api.createPositionCategory,
    rename: api.renamePositionCategory,
    remove: api.deletePositionCategory,
    items: ['position', 'positions'],
    example: 'e.g. Pawn structures, Rook endings',
  },
  concept: {
    list: api.conceptCategories,
    create: api.createConceptCategory,
    rename: api.renameConceptCategory,
    remove: api.deleteConceptCategory,
    items: ['concept', 'concepts'],
    example: 'e.g. Checkmate patterns, Rook endings',
  },
} as const;

const NEW = '\u0000new';

/** Adds a category by name, or finds the one already called that; null if the person cancelled. */
/**
 * Asks for a new category's name and adds it. A name already taken, or too long, is refused in the
 * box itself, which stays open to change it; `pickExisting` takes a taken name's category instead
 * (a picker, where choosing it is what was wanted).
 */
export async function askNewCategory(
  ask: ReturnType<typeof useAskText>,
  kind: CategoryKind = 'position',
  pickExisting = false,
): Promise<PositionCategory | null> {
  const calls = CALLS[kind];
  const done: { category?: PositionCategory } = {};
  await ask('New category', '', calls.example, async (text) => {
    const name = text.trim();
    if (!name) return;
    if (pickExisting) {
      // Compared as the server compares names: no case, single spaces.
      const same = (a: string) => a.toLowerCase().replace(/\s+/g, ' ');
      const existing = (await calls.list()).find((c) => same(c.name) === same(name));
      if (existing) {
        done.category = existing;
        return;
      }
    }
    done.category = await calls.create(name);
  });
  return done.category ?? null;
}

/**
 * An item's category, chosen from the person's own list, with "New category…" at the end when
 * `allowNew`: it asks for a name, adds the category and selects it.
 */
export function CategorySelect({
  value,
  onChange,
  kind = 'position',
  noneLabel = 'None',
  allowNew = false,
  className,
  refreshKey,
}: {
  value: string;
  onChange(name: string): void;
  kind?: CategoryKind;
  noneLabel?: string;
  allowNew?: boolean;
  className?: string;
  /** Change it to reload the list (after a rename elsewhere on the screen). */
  refreshKey?: unknown;
}) {
  const ws = useWorkspace();
  const ask = useAskText();
  const [categories, setCategories] = useState<PositionCategory[]>([]);

  useEffect(() => {
    CALLS[kind].list().then(setCategories).catch(() => setCategories([]));
  }, [refreshKey, kind]);

  const names = categories.map((c) => c.name);
  // A value the list does not hold (yet) still shows instead of falling back to "None".
  if (value && !names.includes(value)) names.push(value);

  return (
    <select
      aria-label="Category"
      className={className}
      value={value}
      onChange={async (e) => {
        if (e.target.value !== NEW) {
          onChange(e.target.value);
          return;
        }
        try {
          const created = await askNewCategory(ask, kind, true);
          if (!created) return;
          setCategories(await CALLS[kind].list());
          onChange(created.name);
        } catch (error) {
          ws.toast((error as Error).message, true);
        }
      }}
    >
      <option value="">{noneLabel}</option>
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
      {allowNew && <option value={NEW}>New category…</option>}
    </select>
  );
}

/**
 * The categories in a side list with their counts: a click filters by one (again clears it), and
 * the one chosen can be renamed or removed; "+ New category" adds one.
 */
export function CategoryList({
  kind,
  categories,
  active,
  onSelect,
  onChanged,
}: {
  kind: CategoryKind;
  categories: PositionCategory[];
  active: string;
  onSelect(name: string): void;
  onChanged(): void;
}) {
  const ws = useWorkspace();
  const confirm = useConfirm();
  const ask = useAskText();
  const calls = CALLS[kind];
  const [one, many] = calls.items;
  const current = categories.find((c) => c.name === active);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      ws.toast((error as Error).message, true);
    }
  };

  return (
    <div>
      <SideHeading
        label="Categories"
        addLabel="New category"
        addTitle="A new category"
        onAdd={() =>
          void run(async () => {
            const created = await askNewCategory(ask, kind);
            if (created) onChanged();
          })
        }
      />
      <SideList
        items={categories.map((c) => ({ id: c.name, label: c.name, count: c.count }))}
        activeId={active}
        // A second click on the active category clears the filter.
        onSelect={(name) => onSelect(name === active ? '' : name)}
      />
      {current && (
        <div className="mt-2 flex gap-3 px-2.5 text-xs">
          <button
            type="button"
            className="text-muted hover:text-text"
            onClick={() =>
              void run(async () => {
                // A name already taken is refused in the box itself, which stays open to change it.
                const done: { renamed?: PositionCategory } = {};
                await ask('Rename category', current.name, '', async (text) => {
                  const name = text.trim();
                  if (name && name !== current.name) done.renamed = await calls.rename(current.id, name);
                });
                if (!done.renamed) return;
                onSelect(done.renamed.name);
                onChanged();
              })
            }
          >
            Rename
          </button>
          <button
            type="button"
            className="text-danger"
            onClick={() =>
              void run(async () => {
                // Not kept in the trash: the items lose the category for good, so ask first.
                const sure = await confirm({
                  title: `Remove the category “${current.name}”?`,
                  message: `Its ${many} stay${kind === 'position' ? ' saved' : ''}, without a category. This cannot be undone.`,
                  confirm: 'Remove category',
                  cancel: 'Keep it',
                });
                if (!sure) return;
                const { uncategorized } = await calls.remove(current.id);
                onSelect('');
                onChanged();
                const stays = kind === 'position' ? 'stays saved' : 'stays';
                const stay = kind === 'position' ? 'stay saved' : 'stay';
                ws.toast(
                  uncategorized
                    ? `Removed the category “${current.name}”. Its ${uncategorized === 1 ? `${one} ${stays}` : `${uncategorized} ${many} ${stay}`}, without a category.`
                    : `Removed the category “${current.name}”.`,
                );
              })
            }
          >
            Remove category
          </button>
        </div>
      )}
    </div>
  );
}
