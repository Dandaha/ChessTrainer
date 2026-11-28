import { type GameEnd, type MoveNode, describeGameEnd, gameEnd, getHeader, isOnMainline, mainlineFrom, writePgn } from '@chess/chess-core';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AnnotationPanel } from '../AnnotationPanel.tsx';
import { Board } from '../Board.tsx';
import { GamesHere, SavedHere } from '../components/PositionPanels.tsx';
import { AddToRepertoireDialog, RepertoireTab } from '../components/RepertoirePanel.tsx';
import { EnginePanel, EvalBar } from '../components/EnginePanel.tsx';
import { CoachPanel, type CoachPanelHandle } from '../components/CoachPanel.tsx';
import type { Annotations } from '../api.ts';
import { useEngine } from '../useEngine.ts';
import type { DrawShape } from '../Board.tsx';
import { SavePositionDialog } from '../components/SavePositionDialog.tsx';
import { ExportDialog, ImportDialog, ShortcutsDialog } from '../Dialogs.tsx';
import { MoveList } from '../MoveList.tsx';
import { useWorkspace } from '../workspace.tsx';

type Dialog = 'import' | 'export' | 'shortcuts' | 'save' | 'repertoire' | null;
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
  const [repertoireRefresh, setRepertoireRefresh] = useState(0);
  const [engineOn, setEngineOn] = useState(false);
  const [coachMarks, setCoachMarks] = useState<Annotations | null>(null);
  const coach = useRef<CoachPanelHandle>(null);
  const moveInput = useRef<HTMLInputElement>(null);

  const { game, current } = g;
  const end = useMemo(() => gameEnd(g.path), [g.path]);
  const engine = useEngine(current.fen, engineOn);
  const best = engine.analysis?.fen === current.fen ? engine.analysis.lines[0] : undefined;
  const engineShapes: DrawShape[] = best?.pv[0]
    ? [{ orig: best.pv[0].slice(0, 2) as DrawShape['orig'], dest: best.pv[0].slice(2, 4) as DrawShape['orig'], brush: 'paleBlue' }]
    : [];
  const coachShapes: DrawShape[] = coachMarks
    ? [
        ...coachMarks.arrows.map((a) => ({ orig: a.from as DrawShape['orig'], dest: a.to as DrawShape['orig'], brush: a.color })),
        ...coachMarks.highlights.map((h) => ({ orig: h.square as DrawShape['orig'], brush: h.color })),
      ]
    : [];
  const toggleEngine = () => {
    setEngineOn((on) => {
      setTab(on ? 'notes' : 'engine');
      return !on;
    });
  };
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
      // At a branch point ↑ and ↓ pick the continuation → follows, as on Lichess; elsewhere they go to
      // the start and the end, like Home and End.
      ArrowUp: () => (current.children.length > 1 ? g.choose(-1) : g.toStart()),
      Home: g.toStart,
      ArrowDown: () => (current.children.length > 1 ? g.choose(1) : g.toEnd()),
      End: g.toEnd,
      f: ws.flip,
      '/': () => moveInput.current?.focus(),
      Delete: () => g.deleteFrom(current.id),
      o: () => setDialog('import'),
      x: () => setDialog('export'),
      s: () => setDialog('save'),
      r: () => setDialog('repertoire'),
      e: toggleEngine,
      c: () => {
        setTab('coach');
        setTimeout(() => coach.current?.focusQuestion(), 0);
      },
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
    { id: 'repertoire', label: 'Repertoire' },
    { id: 'engine', label: engineOn ? 'Engine ●' : 'Engine', key: 'e' },
    { id: 'coach', label: 'Coach', key: 'c' },
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
          <button type="button" className={toolButton} onClick={() => setDialog('repertoire')} title="Add to repertoire (R)">
            Add to repertoire
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
          <div className="flex w-full justify-center gap-2 lg:justify-end">
            {engineOn && (
              <EvalBar
                line={best}
                flipped={ws.orientation === 'black'}
                decided={end ? (end.kind === 'checkmate' ? end.winner : 'draw') : undefined}
              />
            )}
            <Board
              node={current}
              orientation={ws.orientation}
              autoShapes={[...engineShapes, ...coachShapes]}
              onMove={(from, to, promotion) => {
                if (!g.play(promotion ? { from, to, promotion } : { from, to })) g.goTo(current.id);
              }}
              onShapes={g.setShapes}
            />
          </div>
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
          <Branches node={current} choice={g.choice} onEnter={g.goTo} />
          <GameOver end={end} result={game.result} atEnd={!current.children.length} onSetResult={g.setResult} />
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
            {tab === 'saved' && <SavedHere fen={current.fen} refresh={savedRefresh} gameId={ws.linked?.id} onSave={() => setDialog('save')} />}
            {tab === 'repertoire' && (
              <RepertoireTab
                fen={current.fen}
                game={game}
                version={g.version + repertoireRefresh}
                myColor={ws.linkedColor ?? undefined}
                onPlay={(san) => g.play(san)}
                onGoToPly={(ply) => {
                  const node = mainlineFrom(game.root).find((n) => n.ply === ply);
                  if (node) g.goTo(node.id);
                }}
              />
            )}
            {tab === 'engine' &&
              (engineOn ? (
                <EnginePanel
                  state={engine}
                  onTurnOff={toggleEngine}
                  onPlayLine={(sans) => {
                    for (const san of sans) if (!g.play(san)) break;
                  }}
                />
              ) : (
                <div className="space-y-2 p-3 text-sm">
                  <p className="text-muted">Stockfish is off. It runs only while this panel is on.</p>
                  <button type="button" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2" onClick={toggleEngine}>
                    Turn on <kbd>E</kbd>
                  </button>
                </div>
              ))}
            {tab === 'coach' && (
              <CoachPanel
                ref={coach}
                game={game}
                path={g.path}
                myColor={ws.linkedColor ?? undefined}
                onAnnotations={setCoachMarks}
                onPlayLine={(nodeId, sans) => g.playLineFrom(nodeId, sans)}
                onGoTo={g.goTo}
                onGoToPly={(ply) => {
                  const node = mainlineFrom(game.root).find((n) => n.ply === ply);
                  if (node) g.goTo(node.id);
                }}
              />
            )}
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
      {dialog === 'repertoire' && (
        <AddToRepertoireDialog
          rootFen={game.root.fen}
          sans={g.path.slice(1).map((n) => n.san)}
          startPly={game.root.ply}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null);
            setRepertoireRefresh((n) => n + 1);
            ws.toast(message);
          }}
        />
      )}
      {dialog === 'save' && (
        <SavePositionDialog
          fen={current.fen}
          defaults={{
            sourceGameId: ws.linked?.id ?? null,
            sourcePly: ws.linked ? current.ply : null,
            sourceLabel,
            // Not the game's next move: in a saved game that is often the very mistake worth saving.
            // Left empty, training judges the answer with Stockfish.
            answer: null,
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

/**
 * When the position on the board ends the game (mate, stalemate, a draw by rule), says so under the
 * moves, as Lichess does; at the end of the game it offers to write that result into the PGN.
 */
function GameOver({ end, result, atEnd, onSetResult }: { end: GameEnd | null; result: string; atEnd: boolean; onSetResult(result: string): void }) {
  if (!end) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-accent-soft px-3 py-1.5 text-sm">
      <span className="font-medium">{describeGameEnd(end)}</span>
      {atEnd && result !== end.result && (
        <button type="button" className="text-accent hover:underline" onClick={() => onSetResult(end.result)}>
          Set the result to {end.result === '1/2-1/2' ? '½–½' : end.result}
        </button>
      )}
    </div>
  );
}

/**
 * At a branch point, the continuations to choose from: ↑ and ↓ move the choice, → or a click goes
 * into it. The main line is first.
 */
function Branches({ node, choice, onEnter }: { node: MoveNode; choice: number; onEnter(id: string): void }) {
  if (node.children.length < 2) return null;
  const white = node.fen.split(' ')[1] === 'w';
  const number = Number(node.fen.split(' ')[5] ?? 1);
  return (
    <div className="border-t border-line px-3 py-1.5 text-sm" aria-label="Continuations">
      <span className="mr-2 text-xs text-muted">
        <kbd>↑</kbd> <kbd>↓</kbd> choose, <kbd>→</kbd> enter:
      </span>
      {node.children.map((child, i) => (
        <button
          key={child.id}
          type="button"
          aria-pressed={i === choice}
          onClick={() => onEnter(child.id)}
          className={`mr-1 rounded px-1.5 py-0.5 ${i === choice ? 'bg-selected text-on-selected' : 'hover:bg-surface-2'}`}
        >
          {white ? `${number}.` : `${number}...`}
          {child.san}
        </button>
      ))}
    </div>
  );
}
