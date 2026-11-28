import { type ReactNode, useRef } from 'react';

/** Small shared building blocks so every screen looks the same. */

export const inputClass =
  'rounded-md border border-field bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';
export const buttonClass = 'rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-40';
export const primaryClass =
  'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-40';
export const dangerClass = 'rounded-md border border-line px-3 py-1.5 text-sm text-danger hover:bg-surface-2 disabled:opacity-40';

/** A screen's header: its title (the open set or collection, named whole), small actions on it beside
 * the title, and the screen's buttons on the right. */
export function PageHeader({ title, titleActions, children }: { title: string; titleActions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-5 py-3">
      <h1 className="min-w-0 text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1>
      {titleActions && <div className="flex gap-3 text-xs">{titleActions}</div>}
      <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
    </header>
  );
}

/** The heading of a group in a side column ("Sets", "Collections"), with its add button beside it, so
 * the button stays in sight however long the list grows. */
export function SideHeading({ label, addLabel, addTitle, onAdd }: { label: string; addLabel: string; addTitle?: string; onAdd(): void }) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2 px-2.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <button type="button" className="shrink-0 text-xs font-medium text-accent hover:underline" aria-label={addLabel} title={addTitle ?? addLabel} onClick={onAdd}>
        + New
      </button>
    </div>
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
            <span className="truncate" title={item.label}>
              {item.label}
            </span>
            {item.count !== undefined && <span className="shrink-0 text-xs text-muted tabular-nums">{item.count.toLocaleString('en')}</span>}
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
  // A new page starts at its top, not where the last one was scrolled to.
  const box = useRef<HTMLDivElement>(null);
  const go = (next: number) => {
    onChange(next);
    let el = box.current?.parentElement ?? null;
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el?.scrollTo?.({ top: 0 });
  };
  if (total <= limit) return null;
  return (
    <div ref={box} className="flex items-center justify-end gap-2 text-sm text-muted">
      <span className="tabular-nums">
        {(offset + 1).toLocaleString('en')}–{Math.min(offset + limit, total).toLocaleString('en')} of {total.toLocaleString('en')}
      </span>
      <button type="button" className={buttonClass} disabled={offset === 0} onClick={() => go(Math.max(0, offset - limit))}>
        Previous
      </button>
      <button type="button" className={buttonClass} disabled={offset + limit >= total} onClick={() => go(offset + limit)}>
        Next
      </button>
    </div>
  );
}
