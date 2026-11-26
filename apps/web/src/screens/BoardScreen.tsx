import { getHeader, isOnMainline, writePgn } from '@chess/chess-core';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AnnotationPanel } from '../AnnotationPanel.tsx';
import { Board } from '../Board.tsx';
import { GamesHere, SavedHere } from '../components/PositionPanels.tsx';
import { SavePositionDialog } from '../components/SavePositionDialog.tsx';
import { ExportDialog, ImportDialog, ShortcutsDialog } from '../Dialogs.tsx';
import { MoveList } from '../MoveList.tsx';
import { useWorkspace } from '../workspace.tsx';

type Dialog = 'import' | 'export' | 'shortcuts' | 'save' | null;
export type BoardTab = 'notes' | 'games' | 'saved';

export function isTyping(target: EventTarget | null): boolean {
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

/** Extra tabs later phases add beside Notes, Games and Saved. */
export interface ExtraTab {
  id: string;
  label: string;
  key?: string;
  render(): ReactNode;
}

export function BoardScreen({ extraTabs = [] }: { extraTabs?: ExtraTab[] }) {
  const ws = useWorkspace();
  const { g } = ws;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [typed, setTyped] = useState('');
  const [tab, setTab] = useState<string>('notes');
  const [savedRefresh, setSavedRefresh] = useState(0);
  const moveInput = useRef<HTMLInputElement>(null);

  const { game, current } = g;
  const isRoot = current === game.root;
  const onMainline = isOnMainline(game.root, current.id);

  const playTyped = () => {
    if (!typed.trim()) return;
    if (spellings(typed).some((move) => g.play(move))) setTyped('');
    else ws.toast(`${typed.trim()} is not a legal move here.`, true);
  };

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (dialog || isTyping(event.target) || document.querySelector('[data-overlay]')) return;
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      g.undo();
      return;
    }
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void ws.saveToLibrary();
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
      f: ws.flip,
      '/': () => moveInput.current?.focus(),
      Delete: () => g.deleteFrom(current.id),
      o: () => setDialog('import'),
      x: () => setDialog('export'),
      s: () => setDialog('save'),
      '?': () => setDialog('shortcuts'),
    };
    for (const extra of extraTabs) if (extra.key) actions[extra.key] = () => setTab((t) => (t === extra.id ? 'notes' : extra.id));
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      setMenu(null);
      action();
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    const onPointer = () => setMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  // Where a save of this position came from.
  const nextPly = current.ply + 1;
  const sourceLabel = ws.linked
    ? `${ws.linked.label}, move ${Math.ceil(nextPly / 2)}${nextPly % 2 === 1 ? '' : ' (Black to move)'}`
    : null;

  const tabs: { id: string; label: string; key?: string }[] = [
    { id: 'notes', label: 'Notes' },
    { id: 'games', label: 'Games' },
    { id: 'saved', label: 'Saved' },
    ...extraTabs.map(({ id, label, key }) => ({ id, label, key })),
  ];
  const toolButton = 'rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-2';
  const white = getHeader(game, 'White');
  const black = getHeader(game, 'Black');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-surface px-4 py-1.5">
        <span className="mr-2 text-sm">
          {ws.linked ? (
            <>
              <span className="font-medium">{ws.linked.label}</span>{' '}
              <span className="text-muted">{g.dirty ? '· unsaved changes' : '· in library'}</span>
            </>
          ) : (
            <span className="text-muted">Analysis</span>
          )}
        </span>
        <nav className="ml-auto flex flex-wrap items-center gap-1">
          <button type="button" className={toolButton} onClick={ws.newGame}>
            New
          </button>
          <button type="button" className={toolButton} onClick={() => setDialog('import')} title="Open (O)">
            Open
          </button>
          <button
            type="button"
            className={toolButton}
            onClick={() => void ws.saveToLibrary()}
            title="Save to library (Ctrl+S)"
          >
            {ws.linked ? 'Save' : 'Save game'}
          </button>
          <button type="button" className={toolButton} onClick={() => setDialog('save')} title="Save position (S)">
            Save position
          </button>
          <button type="button" className={toolButton} onClick={() => setDialog('export')} title="Export (X)">
            Export
          </button>
          <button type="button" className={toolButton} onClick={ws.flip} title="Flip (F)">
            Flip
          </button>
          <button type="button" className={toolButton} onClick={() => setDialog('shortcuts')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            ?
          </button>
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row lg:items-start lg:justify-center">
        <section className="flex min-w-0 flex-col items-center gap-3 lg:flex-1 lg:items-end">
          <Board
            node={current}
            orientation={ws.orientation}
            onMove={(from, to, promotion) => {
              if (!g.play(promotion ? { from, to, promotion } : { from, to })) g.goTo(current.id);
            }}
            onShapes={g.setShapes}
          />
          <div className="flex w-full max-w-[calc(100dvh-10.5rem)] items-center gap-2">
            <div className="flex gap-1">
              {(
                [
                  ['⏮', 'Start (↑)', g.toStart],
                  ['◀', 'Back (←)', g.back],
                  ['▶', 'Forward (→)', g.forward],
                  ['⏭', 'End (↓)', g.toEnd],
                ] as const
              ).map(([icon, label, action]) => (
                <button
                  key={label}
                  type="button"
                  onClick={action}
                  aria-label={label}
                  title={label}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2"
                >
                  {icon}
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

        <aside className="flex max-h-[calc(100dvh-7rem)] min-h-[24rem] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel lg:w-[26rem]">
          <MoveList game={game} currentId={current.id} onSelect={g.goTo} onMenu={(id, x, y) => setMenu({ id, x, y })} />
          <div className="flex border-t border-line text-sm" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                title={t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label}
                className={`flex-1 px-2 py-1.5 ${tab === t.id ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-text'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="max-h-[45%] min-h-0 overflow-y-auto">
            {tab === 'notes' && (
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
            )}
            {tab === 'games' && (
              <GamesHere fen={current.fen} onPlay={(san) => g.play(san)} onOpen={(id, ply) => void ws.openGameById(id, ply)} />
            )}
            {tab === 'saved' && <SavedHere fen={current.fen} refresh={savedRefresh} onSave={() => setDialog('save')} />}
            {extraTabs.find((t) => t.id === tab)?.render()}
          </div>
        </aside>
      </div>

      {menu && (
        <div
          role="menu"
          className="fixed z-40 min-w-44 rounded-lg border border-line bg-surface py-1 text-sm shadow-panel"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {(
            [
              ['Promote variation', () => g.promote(menu.id), isOnMainline(game.root, menu.id)],
              ['Make main line', () => g.makeMain(menu.id), isOnMainline(game.root, menu.id)],
              ['Delete from here', () => g.deleteFrom(menu.id), false],
            ] as const
          ).map(([label, action, disabled]) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                action();
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {dialog === 'import' && <ImportDialog onLoad={ws.openText} onClose={() => setDialog(null)} />}
      {dialog === 'export' && (
        <ExportDialog
          pgn={writePgn(game)}
          fileName={fileName({ white, black, date: getHeader(game, 'Date') })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'save' && (
        <SavePositionDialog
          fen={current.fen}
          defaults={{
            sourceGameId: ws.linked?.id ?? null,
            sourcePly: ws.linked ? current.ply : null,
            sourceLabel,
            answer: current.children[0] ? current.children[0].san : null,
          }}
          onClose={() => setDialog(null)}
          onSaved={(title) => {
            setDialog(null);
            setSavedRefresh((n) => n + 1);
            ws.toast(`Saved “${title}”.`);
          }}
        />
      )}
    </div>
  );
}

