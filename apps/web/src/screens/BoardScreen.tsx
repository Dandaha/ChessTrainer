import { type GameEnd, type MoveNode, ambiguousMoves, describeGameEnd, gameEnd, materialBalance, moveSpellings, normalizeFen, passTurn, positionKey, getHeader, isOnMainline, mainlineFrom, writePgn } from '@chess/chess-core';
import { fenProblem } from '../loadText.ts';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AnnotationPanel } from '../AnnotationPanel.tsx';
import { Board } from '../Board.tsx';
import { GamesHere, SavedHere } from '../components/PositionPanels.tsx';
import { AddToRepertoireDialog, RepertoireTab } from '../components/RepertoirePanel.tsx';
import { EnginePanel, EvalBar } from '../components/EnginePanel.tsx';
import { CoachPanel, type CoachPanelHandle } from '../components/CoachPanel.tsx';
import type { Annotations } from '../api.ts';
import { useEngine } from '../useEngine.ts';
import { OpeningLabel, useOpenings } from '../openings.tsx';
import { MaterialStrip } from '../components/Material.tsx';
import { type EngineSettings, readEngineSettings, writeEngineSettings } from '../storage.ts';
import type { DrawShape } from '../Board.tsx';
import { SavePositionDialog } from '../components/SavePositionDialog.tsx';
import { ExportDialog, ImportDialog, ShortcutsDialog } from '../Dialogs.tsx';
import { MoveList } from '../MoveList.tsx';
import { BoardEditor } from '../components/BoardEditor.tsx';
import { GameTagsDialog } from '../components/GameTagsDialog.tsx';
import { gameLabel, useWorkspace } from '../workspace.tsx';

type Dialog = 'import' | 'export' | 'shortcuts' | 'save' | 'repertoire' | 'editor' | 'tags' | null;
export type BoardTab = 'notes' | 'games' | 'saved';

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}


function fileName(pgn: { white?: string; black?: string; date?: string }): string {
  // Letters of any alphabet stay: Каспаров-vs-Карпов, not _-vs-_.
  const part = (s?: string) => (s && s !== '?' ? s.normalize('NFC').replace(/[^\p{L}\p{N}-]+/gu, '_') : '');
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
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(readEngineSettings);
  const [threat, setThreat] = useState(false);
  // The FEN field: what is typed there, until Enter opens it (null shows the board's own FEN).
  const [fenText, setFenText] = useState<string | null>(null);
  const [coachMarks, setCoachMarks] = useState<Annotations | null>(null);
  const coach = useRef<CoachPanelHandle>(null);
  const moveInput = useRef<HTMLInputElement>(null);

  const { game, current } = g;
  const end = useMemo(() => gameEnd(g.path), [g.path]);
  // The opening of the move on the board: the deepest named position on the way to it, as on Lichess.
  const openings = useOpenings();
  // Who is up what, for the strips at the board's edges; the side at the bottom is the one it faces.
  const material = useMemo(() => materialBalance(current.fen), [current.fen]);
  const bottom = ws.orientation;
  const top = bottom === 'white' ? 'black' : 'white';
  const opening = useMemo(() => openings?.classifyOpening(g.path.map((n) => n.fen)) ?? null, [openings, g.path]);
  // Threat mode analyses the same position with the other side to move (not possible in check).
  const threatFen = useMemo(() => (engineOn && threat ? passTurn(current.fen) : null), [engineOn, threat, current.fen]);
  const history = useMemo(() => (engineOn && !threatFen ? repetitionHistory(g.path) : undefined), [engineOn, threatFen, g.path]);
  const engine = useEngine(threatFen ?? current.fen, engineOn, engineSettings, history);
  const best = engine.analysis?.fen === current.fen ? engine.analysis.lines[0] : undefined;
  // The position's own score, kept while threat mode analyses the other side's move instead: the bar
  // goes on showing it rather than an empty, even-looking bar.
  const lastBest = useRef<{ fen: string; line: NonNullable<typeof best> } | null>(null);
  if (best) lastBest.current = { fen: current.fen, line: best };
  const barLine = best ?? (threatFen && lastBest.current?.fen === current.fen ? lastBest.current.line : undefined);
  const threatLine = threatFen && engine.analysis?.fen === threatFen ? engine.analysis.lines[0] : undefined;
  const arrow = (line: typeof best, brush: string): DrawShape[] =>
    line?.pv[0] ? [{ orig: line.pv[0].slice(0, 2) as DrawShape['orig'], dest: line.pv[0].slice(2, 4) as DrawShape['orig'], brush }] : [];
  // The engine's arrow is purple on every board (the repertoire's too); threats are red.
  const engineShapes: DrawShape[] = [...arrow(best, 'purple'), ...arrow(threatLine, 'red')];
  const changeEngineSettings = (next: EngineSettings) => {
    setEngineSettings(next);
    writeEngineSettings(next);
  };
  const toggleThreat = () => {
    if (!engineOn) {
      setEngineOn(true);
      setTab('engine');
      setThreat(true);
    } else setThreat((on) => !on);
  };
  const coachShapes: DrawShape[] = coachMarks
    ? [
        ...coachMarks.arrows.map((a) => ({ orig: a.from as DrawShape['orig'], dest: a.to as DrawShape['orig'], brush: a.color })),
        ...coachMarks.highlights.map((h) => ({ orig: h.square as DrawShape['orig'], brush: h.color })),
      ]
    : [];
  const toggleEngine = () => {
    setEngineOn((on) => {
      // On: its tab comes up. Off: the tab stays where it is, unless it was the engine's own.
      if (!on) setTab('engine');
      else setTab((t) => (t === 'engine' ? 'notes' : t));
      return !on;
    });
  };
  const isRoot = current === game.root;
  // At the starting position there is no line to add yet: a word, not a dialog with only that in it.
  const addToRepertoire = () =>
    current === game.root
      ? ws.toast('Go to a move first: R adds the line from the start of the game to the move on the board.')
      : setDialog('repertoire');
  const onMainline = isOnMainline(game.root, current.id);

  const openTypedFen = async () => {
    if (fenText === null || fenText.trim() === current.fen) return setFenText(null);
    try {
      await ws.openFen(normalizeFen(fenText));
      setFenText(null);
    } catch (error) {
      ws.toast(`That is not a position the board can show. ${fenProblem(error as Error)}`, true);
    }
  };
  const copyFen = async () => {
    try {
      await navigator.clipboard.writeText(current.fen);
      ws.toast('FEN copied.');
    } catch {
      ws.toast('Could not reach the clipboard: select the FEN and copy it.', true);
    }
  };

  const playTyped = () => {
    if (!typed.trim()) return;
    if (moveSpellings(typed).some((move) => g.play(move))) return setTyped('');
    // "Nd2" when both knights can go there: say which ones, not that the move is illegal.
    const which = ambiguousMoves(current.fen, typed.trim());
    ws.toast(which.length > 1 ? `${typed.trim()} could be ${which.join(' or ')}: say which piece.` : `${typed.trim()} is not a legal move here.`, true);
  };

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === 'Escape' && menu) {
      setMenu(null);
      return;
    }
    // Ctrl+S saves the game from anywhere on the board, the comment box included (the browser would
    // otherwise offer to save the page).
    if (mod && event.key.toLowerCase() === 's' && !dialog && !document.querySelector('[data-overlay]')) {
      event.preventDefault();
      void ws.saveToLibrary();
      return;
    }
    if (dialog || isTyping(event.target) || document.querySelector('[data-overlay]')) return;
    if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
      event.preventDefault();
      g.redo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      g.undo();
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
      r: addToRepertoire,
      e: toggleEngine,
      t: toggleThreat,
      ' ': () => {
        if (best?.san[0]) g.play(best.san[0]);
      },
      c: () => {
        setTab('coach');
        setTimeout(() => coach.current?.focusQuestion(), 0);
      },
      '?': () => setDialog('shortcuts'),
    };
    for (const extra of extraTabs) if (extra.key) actions[extra.key] = () => setTab((t) => (t === extra.id ? 'notes' : extra.id));
    // Letters work with Shift or Caps Lock too: the shortcuts list writes them as capitals.
    const action = actions[event.key] ?? (event.key.length === 1 ? actions[event.key.toLowerCase()] : undefined);
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
    ? `${gameLabel(game)}, move ${Math.ceil(nextPly / 2)}${nextPly % 2 === 1 ? '' : ' (Black to move)'}`
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
        <span className="mr-2 flex min-w-0 max-w-full items-baseline gap-1 text-sm">
          {ws.linked ? (
            <>
              {/* From the tags as they are now (renamed in Tags… shows at once); cut short, whole on hover. */}
              <span className="min-w-0 truncate font-medium" title={gameLabel(game)}>
                {gameLabel(game)}
              </span>
              <span className="shrink-0 text-muted">{g.dirty ? '· unsaved changes' : '· in library'}</span>
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
          {/* Filled when there is something to save; "Saved" when the library has it as it is. */}
          <button
            type="button"
            className={
              (ws.linked ? g.dirty : game.root.children.length > 0)
                ? 'rounded-md bg-accent px-2.5 py-1.5 text-sm font-medium text-on-accent hover:opacity-90'
                : toolButton
            }
            onClick={() => void ws.saveToLibrary()}
            title="Save to library (Ctrl+S)"
          >
            {ws.linked ? (g.dirty ? 'Save' : 'Saved ✓') : 'Save game'}
          </button>
          <button type="button" className={toolButton} onClick={() => setDialog('save')} title="Save position (S)">
            Save position
          </button>
          <button type="button" className={toolButton} onClick={addToRepertoire} title="Add to repertoire (R)">
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:flex-row md:items-start md:justify-center">
        <section className="analysis-board flex min-w-0 flex-col items-center gap-3 md:flex-1 md:items-end">
          <div className="flex w-full justify-center gap-2 md:justify-end">
            {engineOn && (!engine.error || end) && (
              // Level with the board, not with the strips above and below it. None for an engine that
              // could not start: an empty bar would read as an even position.
              <div className="flex py-6">
                <EvalBar
                  line={barLine}
                  flipped={ws.orientation === 'black'}
                  decided={end ? (end.kind === 'checkmate' ? end.winner : 'draw') : undefined}
                />
              </div>
            )}
            <div className="board-column flex min-w-0 flex-col gap-1">
              <MaterialStrip side={top} material={material[top]} />
              <Board
                node={current}
                orientation={ws.orientation}
                autoShapes={[...engineShapes, ...coachShapes]}
                onMove={(from, to, promotion) => {
                  if (!g.play(promotion ? { from, to, promotion } : { from, to })) g.goTo(current.id);
                }}
                onShapes={g.setShapes}
                onWheelStep={(direction) => (direction < 0 ? g.back() : g.forward())}
              />
              <MaterialStrip side={bottom} material={material[bottom]} />
            </div>
          </div>
          <div className="flex w-full max-w-[calc(100dvh-16rem)] items-center gap-2">
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
              className="min-w-0 flex-1 rounded-md border border-field bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="flex w-full max-w-[calc(100dvh-16rem)] items-center gap-2 text-xs">
            <input
              aria-label="FEN"
              value={fenText ?? current.fen}
              onChange={(e) => setFenText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => setFenText(null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void openTypedFen();
                if (e.key === 'Escape') {
                  setFenText(null);
                  e.currentTarget.blur();
                }
              }}
              title="The position as FEN: type or paste one and press Enter to open it"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-md border border-field bg-surface px-2 py-1 font-mono text-muted outline-none focus:border-accent focus:text-text"
            />
            <button type="button" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2" onClick={() => void copyFen()}>
              Copy FEN
            </button>
            <button type="button" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2" onClick={() => setDialog('editor')} title="Set up a position by placing pieces">
              Set up…
            </button>
            <button type="button" className="rounded-md border border-line px-2 py-1 hover:bg-surface-2" onClick={() => setDialog('tags')} title="Players, event, date and the other tags">
              Tags…
            </button>
          </div>
        </section>

        {/* Beside the board the panel has a fixed height, so it does not jump as moves are added or tabs
            change; only the move list grows and scrolls, everything else keeps its height. */}
        <aside className="flex max-h-[calc(100dvh-7rem)] min-h-[24rem] w-full flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-panel md:h-[calc(100dvh-7rem)] md:w-[22rem] md:shrink-0 xl:w-[26rem]">
          {opening && (
            <div className="shrink-0 truncate border-b border-line px-3 py-1.5 text-xs" aria-label="Opening">
              <OpeningLabel opening={opening} />
            </div>
          )}
          <MoveList game={game} currentId={current.id} onSelect={g.goTo} onMenu={(id, x, y) => setMenu({ id, x, y })} />
          <Branches node={current} choice={g.choice} onEnter={g.goTo} />
          <GameOver end={end} result={game.result} atEnd={!current.children.length && onMainline} onSetResult={g.setResult} />
          <div className="flex shrink-0 overflow-x-auto border-t border-line text-sm" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                title={t.key ? `${t.label} (${t.key.toUpperCase()})` : t.label}
                className={`flex-1 whitespace-nowrap px-1 py-1.5 text-[13px] xl:px-2 xl:text-sm ${tab === t.id ? 'border-b-2 border-accent font-semibold' : 'text-muted hover:text-text'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="max-h-[45%] min-h-0 shrink-0 overflow-y-auto">
            {tab === 'notes' && (
              <AnnotationPanel
                // Afresh after an undo or a load, so the comment box shows what the game now holds.
                key={g.restores}
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
                // Without a colour from the library, the side the board is turned to: White's repertoires
                // say nothing about a game I study from Black's side.
                myColor={ws.linkedColor ?? ws.orientation}
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
                  settings={engineSettings}
                  onSettings={changeEngineSettings}
                  gameOver={end}
                  threat={{ on: threat, side: threatFen ? (current.fen.split(' ')[1] === 'w' ? 'Black' : 'White') : null, onToggle: toggleThreat }}
                  onTurnOff={toggleEngine}
                  onPlayLine={(sans) => g.playLineFrom(current.id, sans)}
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
          // Inside the window: a move near its right or bottom edge opens the menu to its left or above.
          ref={(el) => {
            if (!el) return;
            const box = el.getBoundingClientRect();
            el.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8))}px`;
            el.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8))}px`;
          }}
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
      {dialog === 'editor' && (
        <BoardEditor
          fen={current.fen}
          onClose={() => setDialog(null)}
          onUse={(fen) => {
            setDialog(null);
            void ws.openFen(fen);
          }}
        />
      )}
      {dialog === 'tags' && (
        <GameTagsDialog
          game={game}
          onClose={() => setDialog(null)}
          onSave={(headers, result) => {
            g.setHeaders(headers);
            if (result !== game.result) g.setResult(result);
          }}
        />
      )}
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
    <div role="status" className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-accent-soft px-3 py-1.5 text-sm">
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
    <div className="max-h-28 shrink-0 overflow-y-auto border-t border-line px-3 py-1.5 text-sm" aria-label="Continuations">
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
          {white ? `${number}.` : `${number}…`}
          {child.san}
        </button>
      ))}
    </div>
  );
}

/**
 * The moves the engine needs to see a repetition: those since the last capture or pawn move (only
 * positions after it can repeat), sent only when the position on the board has occurred among them.
 * Otherwise the engine gets the position alone, which its cache can answer.
 */
function repetitionHistory(path: MoveNode[]): { startFen: string; moves: string[] } | undefined {
  const node = path.at(-1);
  if (!node || path.length < 5) return undefined;
  const clock = Number(node.fen.split(' ')[4] ?? 0);
  if (clock < 4) return undefined;
  const span = path.slice(-(clock + 1));
  const key = positionKey(node.fen);
  if (!span.slice(0, -1).some((n) => positionKey(n.fen) === key)) return undefined;
  return { startFen: span[0]!.fen, moves: span.slice(1).map((n) => n.uci) };
}
