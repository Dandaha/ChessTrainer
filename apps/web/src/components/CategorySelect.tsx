import { useEffect, useState } from 'react';
import { type PositionCategory, api } from '../api.ts';
import { useWorkspace } from '../workspace.tsx';
import { useAskText } from './AskText.tsx';

const NEW = '\u0000new';

/** Adds a category by name, or finds the one already called that; null if the person cancelled. */
export async function askNewCategory(ask: ReturnType<typeof useAskText>): Promise<PositionCategory | null> {
  const name = (await ask('New category', '', 'e.g. Pawn structures, Rook endings'))?.trim();
  if (!name) return null;
  try {
    return await api.createPositionCategory(name);
  } catch (error) {
    const existing = (await api.positionCategories()).find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    throw error;
  }
}

/**
 * A saved position's category, chosen from the person's own list, with "New category…" at the end
 * when `allowNew`: it asks for a name, adds the category and selects it.
 */
export function CategorySelect({
  value,
  onChange,
  noneLabel = 'None',
  allowNew = false,
  className,
  refreshKey,
}: {
  value: string;
  onChange(name: string): void;
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
    api.positionCategories().then(setCategories).catch(() => setCategories([]));
  }, [refreshKey]);

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
          const created = await askNewCategory(ask);
          if (!created) return;
          setCategories(await api.positionCategories());
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
