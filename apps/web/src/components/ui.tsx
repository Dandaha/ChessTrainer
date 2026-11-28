import type { ReactNode } from 'react';

/** Small shared building blocks so every screen looks the same. */

export const inputClass =
  'rounded-md border border-field bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';
export const buttonClass = 'rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40';
export const primaryClass =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40';
export const dangerClass = 'rounded-md border border-line px-3 py-1.5 text-sm text-danger hover:bg-surface-2';

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

/** A list in a side column: All, collections, sets... */
export function SideList({
  items,
  activeId,
  onSelect,
}: {
  items: { id: string; label: string; count?: number }[];
  activeId: string;
  onSelect(id: string): void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            onClick={() => onSelect(item.id)}
            className={`flex w-full items-baseline justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm ${
              item.id === activeId ? 'bg-accent-soft font-semibold' : 'hover:bg-surface-2'
            }`}
          >
            <span className="truncate">{item.label}</span>
            {item.count !== undefined && <span className="text-xs text-muted tabular-nums">{item.count}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">{children}</div>;
}

export function Pager({
  offset,
  limit,
  total,
  onChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange(offset: number): void;
}) {
  if (total <= limit) return null;
  return (
    <div className="flex items-center justify-end gap-2 text-sm text-muted">
      <span className="tabular-nums">
        {offset + 1}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Previous
      </button>
      <button type="button" className={buttonClass} disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next
      </button>
    </div>
  );
}
