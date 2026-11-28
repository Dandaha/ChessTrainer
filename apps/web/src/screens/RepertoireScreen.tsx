import {
  type Color,
  type MoveNode,
  type RepEdge,
  type RepTreeNode,
  START_FEN,
  createGame,
  displayComment,
  isMyTurn,
  moveLabel,
  playMove,
  positionKey,
  repertoireTree,
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
import { useWorkspace } from '../workspace.tsx';
import { useAskText } from '../components/AskText.tsx';
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
  return first || node.ply % 2 === 1 ? moveLabel(node.ply, node.edge.san) : node.edge.san;
}

function findNode(nodes: RepTreeNode[], test: (n: RepTreeNode) => boolean): RepTreeNode | undefined {
  for (const n of nodes) {
    if (test(n)) return n;
    const inner = findNode(n.children, test);
    if (inner) return inner;
  }
  return undefined;
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
    await api.addLine(repertoire.id, fen, [san]);
    const { edges: next } = await api.repertoire(repertoire.id);
    setEdges(next);
    const added = next.find((e) => e.fromKey === positionKey(fen) && e.san === san);
    if (added) select(added.id);
  };

  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (dialog || isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
    const place = selected ? placed.get(selected) : undefined;
    const lineIndex = place?.line ?? -1;
    const moves: Record<string, () => void> = {
      // Left and right: the move before and after. Up and down: the line above and below.
      ArrowLeft: () => select(place?.parent?.edge.id ?? null),
      ArrowRight: () => {
        const next = current && place ? current.children[0] : selected ? undefined : tree[0];
        if (next && placed.has(next.edge.id)) select(next.edge.id);
      },
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

  const shapes: DrawShape[] = movesHere.map((e) => ({
    orig: e.uci.slice(0, 2) as DrawShape['orig'],
    dest: e.uci.slice(2, 4) as DrawShape['orig'],
    brush: e.isMyMove ? (e.isMain ? 'green' : 'blue') : 'yellow',
  }));
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
            select(null);
            navigate('repertoire');
            reload();
            ws.toast(`Moved “${repertoire.name}” to the trash (Settings → Trash to restore).`);
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

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 lg:flex-row">
        <div ref={treeRef} className="min-h-[16rem] overflow-y-auto rounded-xl border border-line bg-surface p-2 text-sm lg:w-[26rem]" aria-label="Repertoire tree">
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
                        {!node.edge.isMain && <span className={`text-[10px] ${isSel ? '' : 'text-muted'}`}>side</span>}
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

        <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
          <Board
            node={boardNode(fen, current?.edge.uci ?? '', ply)}
            orientation={color}
            autoShapes={shapes}
            onMove={(from, to, promotion) => void addMove(from, to, promotion)}
            onShapes={() => {}}
          />
          <div className="w-full max-w-[calc(100dvh-10.5rem)] space-y-3 text-sm">
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
        {!e.isMain && (
          <button type="button" className={buttonClass} onClick={() => void update({ isMain: true })}>
            Make main line
          </button>
        )}
      </div>
      <textarea
        aria-label="Comment"
        rows={2}
        defaultValue={e.comment ?? ''}
        onBlur={(ev) => ev.target.value !== (e.comment ?? '') && void update({ comment: ev.target.value })}
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
