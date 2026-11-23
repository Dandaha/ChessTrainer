import { type Color, createGame, getHeader, isOnMainline, parseGame, writePgn } from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';
import { AnnotationPanel } from './AnnotationPanel.tsx';
import { Board } from './Board.tsx';
import { ExportDialog, ImportDialog, ShortcutsDialog } from './Dialogs.tsx';
import { loadText } from './loadText.ts';
import { MoveList } from './MoveList.tsx';
import { type Theme, applyTheme, currentTheme, readDraft, writeDraft } from './storage.ts';
import { useGame } from './useGame.ts';

type Dialog = 'import' | 'export' | 'shortcuts' | null;

function initialGame() {
  const draft = readDraft();
  if (draft) {
    try {
      return parseGame(draft);
    } catch {
      // A broken draft is dropped; the board starts fresh.
    }
  }
  return createGame();
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Typed moves are forgiving: "nf3" means Nf3, and "e2e4" works too. */
function spellings(typed: string): string[] {
  const text = typed.trim();
  const out = [text];
  if (/^[nrqk]/.test(text)) out.push(text[0]!.toUpperCase() + text.slice(1));
  if (/^b/.test(text)) out.push(`B${text.slice(1)}`); // after trying it as a b-pawn move
  return out;
}

function fileName(pgn: { white?: string; black?: string; date?: string }): string {
  const part = (s?: string) => (s && s !== '?' ? s.replace(/[^\w-]+/g, '_') : '');
  const name = [part(pgn.white), part(pgn.black)].filter(Boolean).join('-vs-') || 'analysis';
  const date = pgn.date && !pgn.date.includes('?') ? `-${pgn.date.replace(/\./g, '-')}` : '';
  return `${name}${date}.pgn`;
}

export function App() {
  const g = useGame(initialGame);
  const [orientation, setOrientation] = useState<Color>('white');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [typed, setTyped] = useState('');
  const [serverOnline, setServerOnline] = useState(true);
  const moveInput = useRef<HTMLInputElement>(null);

  const { game, current } = g;
  const isRoot = current === game.root;
  const onMainline = isOnMainline(game.root, current.id);

  // Keep the game on the board across reloads.
  useEffect(() => {
    writeDraft(writePgn(game));
  }, [game, g.version]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => setServerOnline(r.ok))
      .catch(() => setServerOnline(false));
  }, []);

  /** Opens pasted or loaded text; returns an error message or null. */
  const open = (text: string): string | null => {
    const result = loadText(text);
    if ('error' in result) return result.error;
    g.load(result.game);
    setOrientation('white');
    if (result.note) setToast({ text: result.note, error: false });
    return null;
  };

  const playTyped = () => {
    if (!typed.trim()) return;
    if (spellings(typed).some((move) => g.play(move))) {
      setTyped('');
    } else {
      setToast({ text: `${typed.trim()} is not a legal move here.`, error: true });
    }
  };

  // Keyboard shortcuts. They pause while a dialog is open or a field has focus.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (dialog || isTyping(event.target)) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      g.undo();
      return;
    }
    if (mod || event.altKey) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: g.back,
      ArrowRight: g.forward,
      ArrowUp: g.toStart,
      Home: g.toStart,
      ArrowDown: g.toEnd,
      End: g.toEnd,
      f: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
      '/': () => moveInput.current?.focus(),
      Delete: () => g.deleteFrom(current.id),
      o: () => setDialog('import'),
      x: () => setDialog('export'),
      '?': () => setDialog('shortcuts'),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      setMenu(null);
      action();
    }
  };

  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    const onPaste = (event: ClipboardEvent) => {
      if (dialogRef.current || isTyping(event.target)) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      const problem = openRef.current(text);
      if (problem) setToast({ text: problem, error: true });
    };
    const onPointer = () => setMenu(null);
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  const pgn = dialog === 'export' ? writePgn(game) : '';
  const white = getHeader(game, 'White');
  const black = getHeader(game, 'Black');

  const headerButton = 'rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2';

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2">
        <span className="text-lg font-semibold tracking-tight whitespace-nowrap">
          <span className="text-accent">♞</span> Chess Workspace
        </span>
        <nav className="ml-auto flex flex-wrap items-center gap-1">
          <button type="button" className={headerButton} onClick={() => g.load(createGame())}>
            New
          </button>
          <button type="button" className={headerButton} onClick={() => setDialog('import')} title="Open (O)">
            Open
          </button>
          <button type="button" className={headerButton} onClick={() => setDialog('export')} title="Export (X)">
            Export
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}
            title="Flip (F)"
          >
            Flip
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button
            type="button"
            className={headerButton}
            onClick={() => setDialog('shortcuts')}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </nav>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row lg:items-start lg:justify-center">
        <section className="flex min-w-0 flex-col items-center gap-3 lg:flex-1 lg:items-end">
          <Board
            node={current}
            orientation={orientation}
            onMove={(from, to, promotion) => {
              if (!g.play(promotion ? { from, to, promotion } : { from, to })) g.goTo(current.id);
            }}
            onShapes={g.setShapes}
          />
          <div className="flex w-full max-w-[calc(100dvh-10.5rem)] items-center gap-2">
            <div className="flex gap-1">
              {[
                ['⏮', 'Start (↑)', g.toStart],
                ['◀', 'Back (←)', g.back],
                ['▶', 'Forward (→)', g.forward],
                ['⏭', 'End (↓)', g.toEnd],
              ].map(([icon, label, action]) => (
                <button
                  key={label as string}
                  type="button"
                  onClick={action as () => void}
                  aria-label={label as string}
                  title={label as string}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"
                >
                  {icon as string}
                </button>
              ))}
            </div>
            <input
              ref={moveInput}
              aria-label="Type a move"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') playTyped();
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
              placeholder="Type a move, e.g. Nf3   ( / )"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        </section>

        <aside className="flex max-h-[calc(100dvh-6rem)] min-h-[24rem] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel lg:w-[26rem]">
          <MoveList
            game={game}
            currentId={current.id}
            onSelect={g.goTo}
            onMenu={(id, x, y) => setMenu({ id, x, y })}
          />
          <AnnotationPanel
            node={current}
            isRoot={isRoot}
            onMainline={onMainline}
            onComment={g.setCommentText}
            onToggleNag={g.toggleNag}
            onPromote={() => g.promote(current.id)}
            onMakeMain={() => g.makeMain(current.id)}
            onDelete={() => g.deleteFrom(current.id)}
          />
        </aside>
      </main>

      {!serverOnline && (
        <footer className="border-t border-line bg-surface px-4 py-1.5 text-xs text-muted">
          The local server is not running. The board works without it; start both with <kbd>pnpm dev</kbd>.
        </footer>
      )}

      {menu && (
        <div
          role="menu"
          className="fixed z-40 min-w-44 rounded-lg border border-line bg-surface py-1 text-sm shadow-panel"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {[
            ['Promote variation', () => g.promote(menu.id), isOnMainline(game.root, menu.id)],
            ['Make main line', () => g.makeMain(menu.id), isOnMainline(game.root, menu.id)],
            ['Delete from here', () => g.deleteFrom(menu.id), false],
          ].map(([label, action, disabled]) => (
            <button
              key={label as string}
              type="button"
              role="menuitem"
              disabled={disabled as boolean}
              onClick={() => {
                (action as () => void)();
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}

      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border bg-surface px-4 py-2 text-sm shadow-panel ${
            toast.error ? 'border-danger text-danger' : 'border-line'
          }`}
        >
          {toast.text}
        </div>
      )}

      {dialog === 'import' && <ImportDialog onLoad={open} onClose={() => setDialog(null)} />}
      {dialog === 'export' && (
        <ExportDialog
          pgn={pgn}
          fileName={fileName({ white, black, date: getHeader(game, 'Date') })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
