import {
  type Color,
  type MoveNode,
  type RepEdge,
  type RepTreeNode,
  START_FEN,
  createGame,
  displayComment,
  isMyTurn,
  lineLabel,
  moveLabel,
  moveSpellings,
  nagGlyph,
  passTurn,
  playMove,
  positionKey,
  repertoireTree,
  splitComment,
  toggledNags,
} from '@chess/chess-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type RepertoireSummary, api } from '../api.ts';
import { Board, type DrawShape } from '../Board.tsx';
import { Modal } from '../Dialogs.tsx';
import { LinkedConcepts } from '../components/ConceptPicker.tsx';
import { Empty, PageHeader, buttonClass, dangerClass, inputClass, primaryClass } from '../components/ui.tsx';
import { readTextFile } from '../files.ts';
import { download, safeFileName } from '../pieces.ts';
import { navigate, useRoute } from '../router.ts';
import { undoToast, useWorkspace } from '../workspace.tsx';
import { useAskText, useConfirm } from '../components/AskText.tsx';
import { NagButtons } from '../AnnotationPanel.tsx';
import { EnginePanel, EvalBar } from '../components/EnginePanel.tsx';
import { useEngine } from '../useEngine.ts';
import { type EngineSettings, readEngineSettings, readFlag, writeEngineSettings, writeFlag } from '../storage.ts';
import { isTyping } from './BoardScreen.tsx';

/**
 * A row of the explorer: moves that follow one another without a choice, written on one line like a
 * game score (1.e4 e5 2.Nf3 Nc6). Only where the repertoire branches does each continuation start a
 * row of its own, one step further in.
 */
interface Line {
  nodes: RepTreeNode[];
  /** The move the line continues from (null for the first moves of the repertoire). */
  parent: RepTreeNode | null;
  depth: number;
}

function buildLines(starts: RepTreeNode[], collapsed: Set<string>, parent: RepTreeNode | null = null, depth = 0, out: Line[] = []): Line[] {
  for (const start of starts) {
    const nodes = [start];
    let last = start;
    while (last.children.length === 1 && !collapsed.has(last.edge.id)) {
      last = last.children[0]!;
      nodes.push(last);
    }
    out.push({ nodes, parent, depth });
    if (last.children.length > 1 && !collapsed.has(last.edge.id)) buildLines(last.children, collapsed, last, depth + 1, out);
  }
  return out;
}

/** "4.g3" and "3...Nf6" at the start of a line; inside it Black's moves go without a number, as in a score. */
function inlineLabel(node: RepTreeNode, first: boolean): string {
  // How good the move is (! ?! …) goes on the move itself, as in a printed line.
  const quality = node.edge.nags.filter((n) => n >= 1 && n <= 6).map(nagGlyph).join('');
  return `${first || node.ply % 2 === 1 ? moveLabel(node.ply, node.edge.san) : node.edge.san}${quality}`;
}

/** The moves where the tree branches: what "Collapse all" folds. */
function branchPoints(nodes: RepTreeNode[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.children.length > 1) out.add(n.edge.id);
    branchPoints(n.children, out);
  }
  return out;
}

function findNode(nodes: RepTreeNode[], test: (n: RepTreeNode) => boolean): RepTreeNode | undefined {
  for (const n of nodes) {
    if (test(n)) return n;
    const inner = findNode(n.children, test);
    if (inner) return inner;
  }
  return undefined;
}

/** How many moves follow a move in the tree (a transposition's continuation is elsewhere). */
function countBelow(node: RepTreeNode): number {
  return node.transposition ? 0 : node.children.reduce((n, child) => n + 1 + countBelow(child), 0);
}

/** The moves from the start to a move of the tree. */
function lineTo(nodes: RepTreeNode[], edgeId: string, trail: string[] = []): string[] {
  for (const n of nodes) {
    const here = [...trail, n.edge.san];
    if (n.edge.id === edgeId) return here;
    const deeper = lineTo(n.children, edgeId, here);
    if (deeper.length) return deeper;
  }
  return [];
}

/** A board node for a position in the repertoire. */
function boardNode(fen: string, uci: string, ply: number): MoveNode {
  return { ...createGame(fen).root, id: `${fen}|${uci}`, fen, uci, ply };
}

export function RepertoireScreen() {
  const ws = useWorkspace();
  const askText = useAskText();
  const route = useRoute();
  const [list, setList] = useState<RepertoireSummary[] | null>(null);
  const [edges, setEdges] = useState<RepEdge[]>([]);
  const [selected, setSelected] = useState<string | null>(null); // edge id; null = start position
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<'import' | 'gaps' | 'new' | null>(null);
  const [refresh, setRefresh] = useState(0);
  const treeRef = useRef<HTMLDivElement>(null);

  const id = route.parts[1] ?? list?.[0]?.id ?? '';
  const repertoire = list?.find((r) => r.id === id);

  useEffect(() => {
    api.repertoires().then(setList).catch((e: Error) => {
      setList([]);
      ws.toast(e.message, true);
    });
  }, [refresh]);

  useEffect(() => {
    if (!id) return;
    api.repertoire(id).then((r) => setEdges(r.edges)).catch(() => setEdges([]));
  }, [id, refresh]);

  const tree = useMemo(() => repertoireTree(edges), [edges]);
  const lines = useMemo(() => buildLines(tree, collapsed), [tree, collapsed]);
  const branches = useMemo(() => branchPoints(tree), [tree]);
  /** Where each shown move sits: its line and the move before it, for the arrow keys. */
  const placed = useMemo(() => {
    const map = new Map<string, { line: number; parent: RepTreeNode | null }>();
    lines.forEach((line, index) => line.nodes.forEach((node, i) => map.set(node.edge.id, { line: index, parent: i ? line.nodes[i - 1]! : line.parent })));
    return map;
  }, [lines]);
  const current = selected ? findNode(tree, (n) => n.edge.id === selected) : undefined;
  const fen = current?.fen ?? START_FEN;
  const ply = current?.ply ?? 0;
  const color: Color = repertoire?.color ?? 'white';
  const movesHere = useMemo(
    () => edges.filter((e) => e.fromKey === positionKey(fen)).sort((a, b) => Number(b.isMain) - Number(a.isMain)),
    [edges, fen],
  );

  // The board's switches, kept per browser: the engine's lines, its best-move arrow, and the arrows of
  // the moves prepared here. The engine runs while its lines or its arrow are shown.
  const [showLines, setShowLines] = useState(() => readFlag('repertoire-engine-lines'));
  const [showBest, setShowBest] = useState(() => readFlag('repertoire-engine-arrow'));
  const [showMoves, setShowMoves] = useState(() => readFlag('repertoire-move-arrows', true));
  const [engineSettings, setEngineSettings] = useState<EngineSettings>(readEngineSettings);
  const [threat, setThreat] = useState(false);
  const engineOn = showLines || showBest;
  // Threat mode analyses the position with the other side to move (not possible in check).
  const threatFen = useMemo(() => (showLines && threat ? passTurn(fen) : null), [showLines, threat, fen]);
  const engine = useEngine(threatFen ?? fen, engineOn, engineSettings);
  const best = engine.analysis?.fen === fen ? engine.analysis.lines[0] : undefined;
  const threatLine = threatFen && engine.analysis?.fen === threatFen ? engine.analysis.lines[0] : undefined;
  const switchLines = () => {
    writeFlag('repertoire-engine-lines', !showLines);
    if (showLines) setThreat(false);
    setShowLines(!showLines);
  };
  const switchBest = () => {
    writeFlag('repertoire-engine-arrow', !showBest);
    setShowBest(!showBest);
  };
  const switchMoves = () => {
    writeFlag('repertoire-move-arrows', !showMoves);
    setShowMoves(!showMoves);
  };
  const toggleThreat = () => {
    if (!showLines) {
      switchLines();
      setThreat(true);
    } else setThreat((on) => !on);
  };
  const changeEngineSettings = (next: EngineSettings) => {
    setEngineSettings(next);
    writeEngineSettings(next);
  };

  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  const select = (edgeId: string | null) => {
    setSelected(edgeId);
    requestAnimationFrame(() => treeRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }));
  };

  // Moves on the board add to the repertoire from the position shown.
  const addMove = async (from: string, to: string, promotion?: string) => {
    if (!repertoire) return;
    let san: string;
    try {
      san = playMove(boardNode(fen, '', ply), promotion ? { from, to, promotion } : { from, to }).san;
    } catch {
      reload();
      return;
    }
    await addSan(san);
  };

  // A move typed in the box: "nf3" and "e2e4" work too.
  const [typed, setTyped] = useState('');
  const addTyped = async () => {
    const text = typed.trim();
    if (!text) return;
    for (const spelling of moveSpellings(text)) {
      try {
        const move = /^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(spelling)
          ? { from: spelling.slice(0, 2).toLowerCase(), to: spelling.slice(2, 4).toLowerCase(), promotion: spelling[4]?.toLowerCase() }
          : spelling;
        const san = playMove(boardNode(fen, '', ply), move).san;
        setTyped('');
        await addSan(san);
        return;
      } catch {
        // the next spelling
      }
    }
    ws.toast(`${text} is not a legal move here.`, true);
  };

  const addSan = (san: string) => addLine([san]);

  /** Adds moves from the position shown (one, or an engine line up to a move) and goes to the last. */
  const addLine = async (sans: string[]) => {
    if (!repertoire || !sans.length) return;
    const played: MoveNode[] = [];
    let at = boardNode(fen, '', ply);
    try {
      for (const san of sans) played.push((at = playMove(at, san)));
    } catch {
      return;
    }
    const lastFrom = positionKey((played.at(-2) ?? boardNode(fen, '', ply)).fen);
    await api.addLine(repertoire.id, fen, sans);
    const { edges: next } = await api.repertoire(repertoire.id);
    setEdges(next);
    const added = next.find((e) => e.fromKey === lastFrom && e.san === sans.at(-1));
    if (added) select(added.id);
    if (sans.length > 1) ws.toast(`Added ${lineLabel(played)}.`);
  };

  // The move before and after along the line shown (the arrow keys and the wheel over the board).
  const place = selected ? placed.get(selected) : undefined;
  const stepBack = () => select(place?.parent?.edge.id ?? null);
  const stepForward = () => {
    const next = current && place ? current.children[0] : selected ? undefined : tree[0];
    if (next && placed.has(next.edge.id)) select(next.edge.id);
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (dialog || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const lineIndex = place?.line ?? -1;
    const moves: Record<string, () => void> = {
      // Left and right: the move before and after. Up and down: the line above and below.
      ArrowLeft: stepBack,
      ArrowRight: stepForward,
      ArrowDown: () => {
        const line = lines[Math.min(lineIndex + 1, lines.length - 1)];
        if (line) select(line.nodes[0]!.edge.id);
      },
      ArrowUp: () => select(lineIndex <= 0 ? null : lines[lineIndex - 1]!.nodes[0]!.edge.id),
      End: () => {
        const line = lines[lineIndex];
        if (line) select(line.nodes[line.nodes.length - 1]!.edge.id);
      },
      Home: () => select(null),
      e: switchLines,
      a: switchBest,
      v: switchMoves,
      t: toggleThreat,
      // Space adds the engine's best move here (as on the analysis board, where it plays it).
      ...(engineOn && !threatFen && best?.san[0] ? { ' ': () => void addSan(best.san[0]!) } : {}),
    };
    const action = moves[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (list && list.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Repertoire" />
        <div className="mx-auto max-w-lg space-y-4 p-8">
          <Empty>
            No repertoire yet. Start one for White or for Black, then play moves on its board, press R on the analysis
            board, or import a PGN with variations.
          </Empty>
          <NewRepertoire onCreated={(newId) => { reload(); navigate(`repertoire/${newId}`); }} />
        </div>
      </div>
    );
  }

  const drawn = current?.edge.comment ? splitComment(current.edge.comment) : null;
  const engineArrow = (line: typeof best, brush: string): DrawShape[] =>
    line?.pv[0] ? [{ orig: line.pv[0].slice(0, 2) as DrawShape['orig'], dest: line.pv[0].slice(2, 4) as DrawShape['orig'], brush }] : [];
  const shapes: DrawShape[] = [
    ...(showMoves
      ? movesHere.map((e) => ({
          orig: e.uci.slice(0, 2) as DrawShape['orig'],
          dest: e.uci.slice(2, 4) as DrawShape['orig'],
          brush: e.isMyMove ? (e.isMain ? 'green' : 'blue') : 'yellow',
        }))
      : []),
    // The engine's best move in purple: blue is a side move of mine here.
    ...(showBest ? engineArrow(best, 'purple') : []),
    ...engineArrow(threatLine, 'red'),
    // Arrows and circles the move's comment carries ([%cal] [%csl], from a PGN).
    ...(drawn?.arrows ?? []).map((a) => ({ orig: a.from as DrawShape['orig'], dest: a.to as DrawShape['orig'], brush: a.color })),
    ...(drawn?.highlights ?? []).map((h) => ({ orig: h.square as DrawShape['orig'], brush: h.color })),
  ];
  const firstSeen = current?.transposition ? findNode(tree, (n) => n.edge.toKey === current.edge.toKey && !n.transposition) : undefined;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Repertoire">
        <select
          aria-label="Repertoire"
          className={inputClass}
          value={id}
          onChange={(e) => {
            select(null);
            navigate(`repertoire/${e.target.value}`);
          }}
        >
          {list?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.color === 'white' ? '♔' : '♚'} {r.name} ({r.moves})
            </option>
          ))}
        </select>
        <button type="button" className={buttonClass} onClick={() => setDialog('new')}>
          New
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!repertoire}
          onClick={async () => {
            if (!repertoire) return;
            const name = (await askText('Rename repertoire', repertoire.name))?.trim();
            if (!name || name === repertoire.name) return;
            await api.renameRepertoire(repertoire.id, name);
            reload();
          }}
        >
          Rename
        </button>
        <button
          type="button"
          className={dangerClass}
          disabled={!repertoire}
          onClick={async () => {
            if (!repertoire) return;
            await api.deleteRepertoire(repertoire.id);
            setList((all) => all?.filter((r) => r.id !== repertoire.id) ?? all);
            select(null);
            navigate('repertoire');
            reload();
            undoToast(ws, `Moved “${repertoire.name}” to the trash.`, () => api.restore('repertoire', repertoire.id), () => {
              reload();
              navigate(`repertoire/${repertoire.id}`);
            });
          }}
        >
          Delete
        </button>
        <button type="button" className={buttonClass} onClick={() => setDialog('import')} disabled={!repertoire}>
          Import PGN
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!repertoire}
          onClick={async () => {
            const { pgn } = await api.exportRepertoire(id);
            download(new Blob([pgn], { type: 'application/x-chess-pgn' }), `${safeFileName(repertoire!.name)}-${color}.pgn`);
          }}
        >
          Export PGN
        </button>
        <button type="button" className={buttonClass} onClick={() => setDialog('gaps')} disabled={!edges.length}>
          Find gaps
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!edges.length}
          title={selected ? 'Play the line to the selected move, then on from there' : 'Whole lines from the first move, as practice'}
          onClick={() => {
            const line = selected ? lineTo(tree, selected) : [];
            navigate(`training?drill=${id}${line.length ? `&line=${encodeURIComponent(line.join(','))}` : ''}`);
          }}
        >
          Drill line
        </button>
        <button type="button" className={primaryClass} onClick={() => navigate(`training?repertoire=${id}`)} disabled={!edges.length}>
          Train
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:flex-row md:overflow-hidden">
        {/* The tree, and under it the selected move's editor, beside the board: annotating needs no scrolling. */}
        <div className="flex min-h-0 flex-col gap-3 md:h-full md:w-[20rem] md:shrink-0 md:overflow-y-auto xl:w-[26rem]">
        {showLines && (
          <div className="shrink-0 rounded-xl border border-line bg-surface" aria-label="Engine lines">
            <EnginePanel
              state={engine}
              settings={engineSettings}
              onSettings={changeEngineSettings}
              threat={{ on: threat, side: threatFen ? (fen.split(' ')[1] === 'w' ? 'Black' : 'White') : null, onToggle: toggleThreat }}
              onPlayLine={(sans) => void addLine(sans)}
              onTurnOff={switchLines}
              playHint="adds the top line's first move; a click on a move in a line adds the line up to it."
            />
          </div>
        )}
        <div ref={treeRef} className="min-h-[16rem] flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-2 text-sm" aria-label="Repertoire tree">
          {branches.size > 0 && (
            <div className="mb-1 flex justify-end gap-3 px-1 text-xs">
              <button type="button" className="text-muted hover:text-text" onClick={() => setCollapsed(new Set())}>
                Expand all
              </button>
              <button type="button" className="text-muted hover:text-text" onClick={() => setCollapsed(new Set(branches))}>
                Collapse all
              </button>
            </div>
          )}
          <button
            type="button"
            data-selected={selected === null}
            onClick={() => select(null)}
            className={`mb-1 w-full rounded px-2 py-1 text-left ${selected === null ? 'bg-selected text-on-selected' : 'hover:bg-surface-2'}`}
          >
            Starting position
          </button>
          {lines.length === 0 && <p className="px-2 py-3 text-muted">Play a move on the board to start this repertoire.</p>}
          {lines.map((line) => {
            const last = line.nodes[line.nodes.length - 1]!;
            const folds = last.children.length > 1 || (collapsed.has(last.edge.id) && last.children.length > 0);
            const folded = collapsed.has(last.edge.id);
            return (
              <div key={line.nodes[0]!.edge.id} data-line className="flex items-start" style={{ paddingLeft: line.depth * 14 }}>
                <button
                  type="button"
                  aria-label={folds ? (folded ? 'Expand' : 'Collapse') : undefined}
                  disabled={!folds}
                  onClick={() =>
                    setCollapsed((c) => {
                      const next = new Set(c);
                      if (next.has(last.edge.id)) next.delete(last.edge.id);
                      else next.add(last.edge.id);
                      return next;
                    })
                  }
                  className="mt-1 w-4 shrink-0 text-xs text-muted disabled:opacity-0"
                >
                  {folded ? '▸' : '▾'}
                </button>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-0.5">
                  {line.nodes.map((node, i) => {
                    const isSel = node.edge.id === selected;
                    return (
                      <button
                        key={node.edge.id}
                        type="button"
                        data-selected={isSel}
                        onClick={() => select(node.edge.id)}
                        className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-left ${
                          isSel ? 'bg-selected text-on-selected' : 'hover:bg-surface-2'
                        }`}
                      >
                        <span className={node.edge.isMyMove ? 'font-semibold' : isSel ? '' : 'text-muted'}>{inlineLabel(node, i === 0)}</span>
                        {node.edge.nags.some((n) => n > 6) && (
                          <span className={isSel ? '' : 'text-muted'}>{node.edge.nags.filter((n) => n > 6).map(nagGlyph).join(' ')}</span>
                        )}
                        {/* Side: an alternative of mine. The opponent's replies are all prepared alike. */}
                        {node.edge.isMyMove && !node.edge.isMain && <span className={`text-[10px] ${isSel ? '' : 'text-muted'}`}>side</span>}
                        {node.edge.priority === 'nice' && <span className={`text-[10px] ${isSel ? '' : 'text-muted'}`}>nice</span>}
                        {node.edge.comment && <span title={displayComment(node.edge.comment)}>✎</span>}
                        {node.transposition && (
                          <span className={`rounded px-1 text-[10px] ${isSel ? 'bg-black/20' : 'bg-accent-soft'}`} title="Reached by another move order too">
                            ⇄ transposes
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {folded && <span className="px-1 text-xs text-muted">… {last.children.length} {last.children.length === 1 ? 'line' : 'lines'}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {current && (
              <MoveEditor
                key={current.edge.id}
                node={current}
                onChanged={reload}
                onDeleted={(n) => {
                  ws.toast(`Deleted ${n} move${n === 1 ? '' : 's'}.`);
                  select(null);
                  reload();
                }}
                onOpenBoard={() => {
                  const path: string[] = [];
                  const walk = (nodes: RepTreeNode[], trail: string[]): boolean => {
                    for (const n of nodes) {
                      if (n === current || walk(n.children, [...trail, n.edge.san])) {
                        if (n === current) path.push(...trail, n.edge.san);
                        return true;
                      }
                    }
                    return false;
                  };
                  walk(tree, []);
                  ws.openLine(START_FEN, path);
                  ws.setOrientation(color);
                }}
              />
            )}
        </div>

        <div className="repertoire-board flex min-w-0 flex-1 flex-col items-center gap-3 md:h-full md:overflow-y-auto">
          <div role="group" aria-label="Board display" className="flex w-full max-w-[calc(100dvh-13.5rem)] flex-wrap items-center gap-2 text-sm">
            <Switch on={showLines} onToggle={switchLines} label="Engine lines" shortcut="E" />
            <Switch on={showBest} onToggle={switchBest} label="Best-move arrow" shortcut="A" swatch="#68217a" />
            <Switch on={showMoves} onToggle={switchMoves} label="Variation arrows" shortcut="V" swatch="#15781B" />
            {engineOn && !showLines && engine.error && <span className="text-xs text-danger">{engine.error}</span>}
          </div>
          <div className="flex w-full justify-center gap-2">
            {engineOn && <EvalBar line={best} flipped={color === 'black'} />}
            <Board
              node={boardNode(fen, current?.edge.uci ?? '', ply)}
              orientation={color}
              autoShapes={shapes}
              onMove={(from, to, promotion) => void addMove(from, to, promotion)}
              onShapes={() => {}}
              onWheelStep={(direction) => (direction < 0 ? stepBack() : stepForward())}
            />
          </div>
          <div className="w-full max-w-[calc(100dvh-13.5rem)] space-y-3 text-sm">
            <input
              aria-label="Type a move to add"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTyped();
                if (e.key === 'Escape') e.currentTarget.blur();
              }}
              placeholder={`Type a move to add here, e.g. ${isMyTurn(fen, color) ? 'Nf3' : 'the reply you expect'}`}
              spellCheck={false}
              autoComplete="off"
              disabled={!repertoire}
              className={`${inputClass} w-full`}
            />
            <p>
              {isMyTurn(fen, color) ? (
                movesHere.length ? (
                  <>
                    <span className="text-muted">You play </span>
                    {movesHere.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 && ' or '}
                        <button type="button" className="font-semibold text-accent" onClick={() => select(findNode(tree, (n) => n.edge.id === m.id)?.edge.id ?? null)}>
                          {m.san}
                        </button>
                        {!m.isMain && <span className="text-muted"> (side)</span>}
                      </span>
                    ))}
                  </>
                ) : (
                  <span className="text-muted">Your move: nothing prepared yet. Play it on the board to add it.</span>
                )
              ) : movesHere.length ? (
                <>
                  <span className="text-muted">Expected: </span>
                  {movesHere.map((m, i) => (
                    <span key={m.id}>
                      {i > 0 && ', '}
                      <button type="button" className="font-semibold" onClick={() => select(m.id)}>
                        {m.san}
                      </button>
                    </span>
                  ))}
                </>
              ) : (
                <span className="text-muted">Opponent to move: play the replies you expect to add them.</span>
              )}
            </p>
            {firstSeen && (
              <p className="rounded-md bg-accent-soft px-3 py-2">
                This position is also reached by another move order.{' '}
                <button type="button" className="font-semibold text-accent" onClick={() => select(firstSeen.edge.id)}>
                  Continue there
                </button>
              </p>
            )}
          </div>
        </div>
      </div>

      {dialog === 'new' && (
        <Modal title="New repertoire" onClose={() => setDialog(null)}>
          <NewRepertoire
            onCreated={(newId) => {
              setDialog(null);
              reload();
              navigate(`repertoire/${newId}`);
            }}
          />
        </Modal>
      )}
      {dialog === 'import' && repertoire && (
        <ImportRepertoire repertoire={repertoire} onClose={() => setDialog(null)} onDone={reload} />
      )}
      {dialog === 'gaps' && repertoire && (
        <GapsDialog
          repertoire={repertoire}
          onClose={() => setDialog(null)}
          onShow={(gapFen) => {
            setDialog(null);
            const node = findNode(tree, (n) => positionKey(n.fen) === positionKey(gapFen));
            select(node?.edge.id ?? null);
          }}
          onAdd={async (gapFen, san) => {
            await api.addLine(repertoire.id, gapFen, [san]);
            reload();
          }}
        />
      )}
    </div>
  );
}

/** An on/off switch above the board, with its key and, for an arrow, the arrow's colour. */
function Switch({ on, onToggle, label, shortcut, swatch }: { on: boolean; onToggle(): void; label: string; shortcut: string; swatch?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      title={`${label}: ${on ? 'on' : 'off'} (${shortcut})`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${on ? 'border-accent bg-accent-soft font-medium' : 'border-line text-muted hover:bg-surface-2'}`}
    >
      <span aria-hidden className={`h-2 w-2 rounded-full ${on ? 'bg-accent' : 'border border-field'}`} />
      {swatch && <span aria-hidden className="h-0.5 w-3 rounded" style={{ backgroundColor: swatch }} />}
      {label}
      <kbd>{shortcut}</kbd>
    </button>
  );
}

function NewRepertoire({ onCreated }: { onCreated(id: string): void }) {
  const [name, setName] = useState('Main');
  const create = async (color: Color) => onCreated((await api.createRepertoire(name, color)).id);
  return (
    <div className="space-y-3">
      <input aria-label="Name" className={`${inputClass} w-full`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main, Surprise weapons…" />
      <div className="flex gap-2">
        <button type="button" className={primaryClass} onClick={() => void create('white')}>
          ♔ For White
        </button>
        <button type="button" className={primaryClass} onClick={() => void create('black')}>
          ♚ For Black
        </button>
      </div>
    </div>
  );
}

function MoveEditor({
  node,
  onChanged,
  onDeleted,
  onOpenBoard,
}: {
  node: RepTreeNode;
  onChanged(): void;
  onDeleted(n: number): void;
  onOpenBoard(): void;
}) {
  const e = node.edge;
  const confirm = useConfirm();
  const update = async (changes: Parameters<typeof api.updateRepertoireMove>[1]) => {
    await api.updateRepertoireMove(e.id, changes);
    onChanged();
  };
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{moveLabel(node.ply, e.san)}</span>
        {/* Whose move it is follows from the repertoire's colour, so it is shown, not chosen. */}
        <span className="text-xs text-muted">{e.isMyMove ? 'my move' : 'expected reply'}</span>
        <select aria-label="Priority" className={inputClass} value={e.priority} onChange={(ev) => void update({ priority: ev.target.value as 'must' | 'nice' })}>
          <option value="must">Must know</option>
          <option value="nice">Nice to know</option>
        </select>
        {!e.isMain &&
          (e.isMyMove ? (
            <button type="button" className={buttonClass} onClick={() => void update({ isMain: true })} title="The move you play here; the other becomes your side move">
              Make main line
            </button>
          ) : (
            <button
              type="button"
              className={buttonClass}
              onClick={() => void update({ isMain: true })}
              title="List this reply first here; the PGN export writes it as the main line. Replies are trained alike either way."
            >
              Move to top
            </button>
          ))}
      </div>
      <NagButtons nags={e.nags} onToggle={(nag) => void update({ nags: toggledNags(e.nags, nag) })} />
      <textarea
        aria-label="Comment"
        rows={2}
        defaultValue={displayComment(e.comment ?? '')}
        onBlur={(ev) => {
          // The words are edited; drawing commands ([%cal] …) stay attached, out of sight.
          const commands = (e.comment ?? '').match(/\[%[^\]]*\]/g) ?? [];
          const next = [...commands, ev.target.value.trim()].join(' ').trim();
          if (next !== (e.comment ?? '').trim()) void update({ comment: next || null });
        }}
        placeholder="Why this move, what to remember…"
        className={`${inputClass} w-full`}
      />
      <LinkedConcepts targetType="repertoire_move" targetId={e.id} />
      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={onOpenBoard}>
          Open on analysis board
        </button>
        <button
          type="button"
          className={dangerClass}
          onClick={async () => {
            // Not kept in the trash, and the moves' training progress goes with them: ask when it is more than one move.
            const after = countBelow(node);
            if (
              after > 0 &&
              !(await confirm({
                title: `Delete ${moveLabel(node.ply, e.san)} and what follows?`,
                message: `${after} move${after === 1 ? '' : 's'} after it go too, with their comments and training progress. This cannot be undone.`,
                confirm: 'Delete them',
                cancel: 'Keep them',
              }))
            )
              return;
            const { deleted } = await api.deleteRepertoireMove(e.id);
            onDeleted(deleted);
          }}
        >
          Delete move and what follows
        </button>
      </div>
    </div>
  );
}

function ImportRepertoire({ repertoire, onClose, onDone }: { repertoire: RepertoireSummary; onClose(): void; onDone(): void }) {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  // Games that could not be read or did not connect to the repertoire: the dialog stays open on them.
  const [problems, setProblems] = useState<string[]>([]);
  return (
    <Modal title={`Import into “${repertoire.name}” (${repertoire.color})`} onClose={onClose}>
      <textarea aria-label="PGN" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="PGN with variations; every move becomes part of the repertoire." className={`${inputClass} w-full font-mono`} />
      {problems.length > 0 && (
        <div role="alert" className="mt-2 max-h-40 space-y-1 overflow-auto text-sm text-danger">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-between">
        <label className={`${buttonClass} cursor-pointer`}>
          Open file…
          <input type="file" accept=".pgn,.txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await readTextFile(f)); }} />
        </label>
        <button
          type="button"
          className={primaryClass}
          disabled={!text.trim()}
          onClick={async () => {
            try {
              const r = await api.importRepertoire(repertoire.id, text);
              ws.toast(`Added ${r.added} move${r.added === 1 ? '' : 's'} (${r.existing} already there) from ${r.games} game${r.games === 1 ? '' : 's'}.`);
              onDone();
              if (r.errors.length) {
                setProblems(r.errors.map((e) => (e.message.startsWith('Game ') ? e.message : `Game ${e.gameIndex + 1}${e.line ? `, line ${e.line}` : ''}: ${e.message}`)));
              } else {
                onClose();
              }
            } catch (e) {
              ws.toast((e as Error).message, true);
            }
          }}
        >
          Import
        </button>
      </div>
    </Modal>
  );
}

function GapsDialog({
  repertoire,
  onClose,
  onShow,
  onAdd,
}: {
  repertoire: RepertoireSummary;
  onClose(): void;
  onShow(fen: string): void;
  onAdd(fen: string, san: string): Promise<void>;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.gaps>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    api.gaps(repertoire.id).then(setData).catch((e: Error) => setError(e.message));
  }, [repertoire.id]);
  return (
    <Modal title="Gaps: common replies you have not prepared" onClose={onClose}>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Asking the Lichess opening explorer about each position… this takes a few seconds.</p>}
      {data && data.gaps.length === 0 && <p className="text-sm text-muted">No gap above 5% in the {data.checked} positions checked.</p>}
      {data && data.gaps.length > 0 && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {data.gaps.map((g) => {
              const key = `${g.fen}|${g.move.uci}`;
              return (
                <tr key={key}>
                  <td className="py-1.5">{moveLabel(g.ply + 1, g.move.san)}</td>
                  <td className="text-right tabular-nums text-muted">{Math.round(g.share * 100)}%</td>
                  <td className="text-right">
                    <button type="button" className="mr-2 text-accent" onClick={() => onShow(g.fen)}>
                      Show
                    </button>
                    <button
                      type="button"
                      disabled={added.has(key)}
                      className="text-accent disabled:text-muted"
                      onClick={async () => {
                        await onAdd(g.fen, g.move.san);
                        setAdded((s) => new Set(s).add(key));
                      }}
                    >
                      {added.has(key) ? 'Added' : 'Add as expected reply'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
