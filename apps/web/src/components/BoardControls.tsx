import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { type BoardPrefs, useBoardPrefs, writeBoardPref } from '../storage.ts';
import { Icon, type IconName } from './icons.tsx';
import { Toggle } from './ui.tsx';

/**
 * The small controls around a board: the move buttons under it (start, back, forward, end), and a
 * strip of tools beside it (flip, full screen, board settings), with a tip (ⓘ) for anything that
 * needs explaining. Icons, not text, so they take little room.
 */

const iconButton = 'grid h-8 w-8 place-items-center rounded-md border border-line bg-surface text-muted hover:bg-surface-2 hover:text-text';

/** A button of the board's toolbars: an icon, no border; a soft highlight on hover, green when on. */
const toolButton =
  'group/tool relative grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text active:scale-95 motion-reduce:transition-none ' +
  'aria-pressed:bg-accent-soft aria-pressed:text-accent aria-expanded:bg-accent-soft aria-expanded:text-accent';

/** The name of a toolbar button, with its key, shown beside it on hover or keyboard focus. */
function Tip({ label, shortcut, side }: { label: string; shortcut?: string; side: 'left' | 'above' }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute z-50 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs font-medium text-bg opacity-0 shadow-panel transition-opacity delay-300 duration-150 group-hover/tool:opacity-100 group-focus-visible/tool:opacity-100 motion-reduce:transition-none ${
        side === 'left' ? 'top-1/2 right-full mr-2 -translate-y-1/2' : 'bottom-full left-1/2 mb-2 -translate-x-1/2'
      }`}
    >
      {label}
      {shortcut && <kbd className="!border-bg/30 !bg-transparent !text-bg">{shortcut}</kbd>}
    </span>
  );
}

/** Start, back, forward, end. */
export function MoveNav({ onStart, onBack, onForward, onEnd }: { onStart(): void; onBack(): void; onForward(): void; onEnd(): void }) {
  const buttons: [IconName, string, () => void][] = [
    ['first', 'Start (Home)', onStart],
    ['prev', 'Back (←)', onBack],
    ['next', 'Forward (→)', onForward],
    ['last', 'End of the line (End)', onEnd],
  ];
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5 shadow-sm" role="group" aria-label="Moves">
      {buttons.map(([icon, label, action]) => {
        const [name, key] = label.split(' (');
        return (
          <button key={icon} type="button" onClick={action} aria-label={label} className={`${toolButton} w-9`}>
            <Icon name={icon} size={17} />
            <Tip label={name!} shortcut={key?.replace(')', '')} side="above" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * Flip, full screen and the board settings, in a column beside the board. Full screen takes the
 * element given (the board and what goes with it) to the whole screen; Escape comes back.
 */
export function BoardTools({ onFlip, fullScreen }: { onFlip(): void; fullScreen: RefObject<HTMLElement | null> }) {
  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const changed = () => setIsFull(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  return (
    <div
      className="flex h-fit shrink-0 flex-col items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5 shadow-sm"
      role="toolbar"
      aria-label="Board tools"
      aria-orientation="vertical"
    >
      <button type="button" className={toolButton} onClick={onFlip} aria-label="Flip the board (F)">
        <Icon name="flip" size={17} />
        <Tip label="Flip the board" shortcut="F" side="left" />
      </button>
      <button
        type="button"
        className={toolButton}
        aria-pressed={isFull}
        aria-label={isFull ? 'Leave full screen (Esc)' : 'Full screen'}
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void fullScreen.current?.requestFullscreen?.().catch(() => {});
        }}
      >
        <Icon name={isFull ? 'shrink' : 'expand'} size={17} />
        <Tip label={isFull ? 'Leave full screen' : 'Full screen'} shortcut={isFull ? 'Esc' : undefined} side="left" />
      </button>
      <span aria-hidden className="my-0.5 h-px w-5 bg-line" />
      <Popover label="Board settings" icon="settings" side="left" className={toolButton} tip>
        <BoardSettings />
      </Popover>
    </div>
  );
}

/** How every board looks: the switches behind the gear beside a board. */
function BoardSettings() {
  const prefs = useBoardPrefs();
  const rows: [keyof BoardPrefs, string][] = [
    ['lastMove', 'Highlight the last move'],
    ['legalMoves', 'Show legal moves'],
    ['coordinates', 'Coordinates'],
  ];
  return (
    <div>
      <p className="px-2 pt-1 pb-1.5 text-sm font-semibold">Board</p>
      <div className="space-y-0.5">
        {rows.map(([key, label]) => (
          <Toggle key={key} row on={prefs[key]} onToggle={() => writeBoardPref(key, !prefs[key])} label={label} />
        ))}
      </div>
      <p className="px-2 pt-1.5 text-xs text-muted">For every board in the app.</p>
    </div>
  );
}

/**
 * A small icon button that opens a panel next to it: settings, or a longer explanation (ⓘ). Escape
 * or a click elsewhere closes it.
 */
export function Popover({
  label,
  icon,
  children,
  side = 'below',
  className = iconButton,
  tip = false,
}: {
  label: string;
  icon: IconName;
  children: ReactNode;
  side?: 'below' | 'left';
  className?: string;
  /** A toolbar button: its name shows as the toolbar's tooltip, not the browser's. */
  tip?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" className={className} aria-label={label} title={tip ? undefined : label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={icon} size={tip ? 17 : 16} />
        {tip && !open && <Tip label={label} side="left" />}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`pop-in absolute z-40 w-64 rounded-xl border border-line bg-surface p-1.5 text-sm shadow-panel ${
            side === 'left' ? 'top-0 right-full mr-2 origin-top-right' : 'top-full right-0 mt-1 origin-top-right'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** ⓘ: a short explanation, kept out of the way until asked for. */
export function InfoTip({ children, label = 'How this works' }: { children: ReactNode; label?: string }) {
  return (
    <Popover label={label} icon="info" className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-text">
      <div className="p-1 text-xs leading-relaxed">{children}</div>
    </Popover>
  );
}

/** "⋯": the actions a screen needs now and then, in a menu instead of a row of buttons. */
export function MoreMenu({ label = 'More', items }: { label?: string; items: { label: string; onSelect(): void; danger?: boolean; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid h-[34px] w-9 place-items-center rounded-md border border-line bg-surface hover:bg-surface-2"
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div role="menu" className="absolute top-full right-0 z-40 mt-1 min-w-44 rounded-lg border border-line bg-surface py-1 text-sm shadow-panel">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`block w-full px-3 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40 ${item.danger ? 'text-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
