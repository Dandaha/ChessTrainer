import { START_FEN, answerProblem, mainlineFrom, parseGame, positionKey } from '@chess/chess-core';
import { useCallback, useEffect, useState } from 'react';
import { type PositionCategory, type PositionSetSummary, type SavedPosition, api } from '../api.ts';
import { MiniBoard } from '../components/MiniBoard.tsx';
import { CategoryList, CategorySelect } from '../components/CategorySelect.tsx';
import { Empty, PageHeader, Pager, SideList, buttonClass, dangerClass, inputClass, primaryClass } from '../components/ui.tsx';
import { savedToPgn } from '../exporters.ts';
import { Markdown } from '../components/Markdown.tsx';
import { LinkedConcepts } from '../components/ConceptPicker.tsx';
import { boardPng, download, safeFileName } from '../pieces.ts';
import { navigate, useRoute } from '../router.ts';
import { undoToast, useWorkspace } from '../workspace.tsx';
import { useAskText, useConfirm } from '../components/AskText.tsx';
import { BoardEditor } from '../components/BoardEditor.tsx';
import { SavePositionDialog } from '../components/SavePositionDialog.tsx';
import { OpeningLabel, useOpenings } from '../openings.tsx';

const LIMIT = 60;

/** Side-list entries that are not sets. */
const LISTS = [
  { id: 'all', label: 'All positions' },
  { id: 'training', label: 'In training' },
  { id: 'recent', label: 'Saved in the last 30 days' },
  { id: 'games', label: 'From my games' },
];

export function PositionsScreen() {
  const ws = useWorkspace();
  const route = useRoute();
  const [sets, setSets] = useState<PositionSetSummary[]>([]);
  // `positions?set=<id>` opens a set (coming back from solving or presenting it).
  const [list, setList] = useState(() => {
    const set = route.params.get('set');
    return set ? `set:${set}` : 'all';
  });
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<PositionCategory[]>([]);
  const [tag, setTag] = useState('');
  const [tagOptions, setTagOptions] = useState<{ name: string; count: number }[]>([]);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; positions: SavedPosition[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(route.params.get('open'));
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const askText = useAskText();

  const setId = list.startsWith('set:') ? list.slice(4) : '';
  const currentSet = sets.find((s) => s.id === setId);

  useEffect(() => {
    const open = route.params.get('open');
    if (open) setOpenId(open);
  }, [route]);

  useEffect(() => {
    api.sets().then(setSets).catch(() => {});
    api.positionCategories().then(setCategories).catch(() => {});
    api.tags('saved_position').then(setTagOptions).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .savedPositions({
          q: q || undefined,
          category: category || undefined,
          tag: tag || undefined,
          setId: setId || undefined,
          inTraining: list === 'training' ? true : undefined,
          source: list === 'games' ? 'game' : undefined,
          since: list === 'recent' ? new Date(Date.now() - 30 * 86_400_000).toISOString() : undefined,
          limit: setId ? 500 : LIMIT,
          offset: setId ? 0 : offset,
        })
        .then((d) => {
          if (!live) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, category, tag, list, setId, offset, refresh]);

  const newSet = async () => {
    let id = '';
    const name = await askText('New set', '', 'e.g. Lesson: Greek gift', async (text) => ({ id } = await api.createSet(text)));
    if (!name) return;
    reload();
    setList(`set:${id}`);
  };

  const move = async (index: number, by: number) => {
    if (!data || !setId) return;
    const ids = data.positions.map((p) => p.id);
    const [item] = ids.splice(index, 1);
    ids.splice(index + by, 0, item!);
    await api.reorderSet(setId, ids);
    reload();
  };

  const open = data?.positions.find((p) => p.id === openId);

  // A position set up by hand: first the board (pieces, whose move, castling, en passant, counters),
  // then its details. Going back to the board keeps the details typed so far.
  const [setup, setSetup] = useState<{ fen: string; step: 'board' | 'details'; detailsOpened: boolean } | null>(null);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={currentSet ? currentSet.name : 'Positions'}>
        <button
          type="button"
          className={currentSet && data && data.total > 0 ? buttonClass : primaryClass}
          onClick={() => setSetup({ fen: START_FEN, step: 'board', detailsOpened: false })}
          title={currentSet ? `Set up a position and save it in “${currentSet.name}”` : 'Set up a position on a board and save it'}
        >
          New position
        </button>
        {currentSet && data && data.total > 0 && (
          <>
            <button type="button" className={primaryClass} onClick={() => navigate(`present/${currentSet.id}`)}>
              Present
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => navigate(`training?set=${currentSet.id}`)}
              title="Solve the set's positions one by one, as practice: your review schedule is not changed"
            >
              Solve
            </button>
            <button type="button" className={buttonClass} onClick={() => navigate(`print/${currentSet.id}`)}>
              Worksheet (print / PDF)
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                download(new Blob([savedToPgn(data.positions)], { type: 'application/x-chess-pgn' }), `${safeFileName(currentSet.name)}.pgn`)
              }
            >
              Export PGN
            </button>
          </>
        )}
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 space-y-4 overflow-y-auto border-r border-line p-3">
          <SideList items={LISTS} activeId={list} onSelect={(id) => { setList(id); setOffset(0); }} />
          <div>
            <div className="mb-1 px-2.5 text-xs font-semibold uppercase tracking-wide text-muted">Sets</div>
            <SideList
              items={sets.map((s) => ({ id: `set:${s.id}`, label: s.name, count: s.positions }))}
              activeId={list}
              onSelect={(id) => setList(id)}
            />
            <button type="button" className="mt-1 px-2.5 text-sm text-accent" onClick={() => void newSet()}>
              + New set
            </button>
            {currentSet && (
              <div className="mt-2 flex gap-3 px-2.5 text-xs">
                <button
                  type="button"
                  className="text-muted hover:text-text"
                  onClick={async () => {
                    const name = await askText('Rename set', currentSet.name, '', (text) => api.updateSet(currentSet.id, { name: text }));
                    if (name) reload();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="text-danger"
                  onClick={async () => {
                    await api.deleteSet(currentSet.id);
                    setList('all');
                    reload();
                    undoToast(ws, `Moved the set “${currentSet.name}” to the trash. Its positions stay saved.`, () => api.restore('position_set', currentSet.id), reload);
                  }}
                >
                  Delete set
                </button>
              </div>
            )}
          </div>
          <CategoryList
            kind="position"
            categories={categories}
            active={category}
            onSelect={(name) => {
              setCategory(name);
              setOffset(0);
            }}
            onChanged={reload}
          />
        </aside>

        <section className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-2">
            <input aria-label="Search positions" className={`${inputClass} w-64`} placeholder="Search titles, ideas, notes, tags…" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} />
            <CategorySelect
              value={category}
              onChange={(name) => {
                setCategory(name);
                setOffset(0);
              }}
              noneLabel="Any category"
              className={inputClass}
              refreshKey={categories}
            />
            <select aria-label="Tag" className={inputClass} value={tag} onChange={(e) => { setTag(e.target.value); setOffset(0); }}>
              <option value="">Any tag</option>
              {tagOptions.map((t) => (
                <option key={t.name} value={t.name}>
                  #{t.name} ({t.count})
                </option>
              ))}
            </select>
          </div>

          {error && <Empty>{error}</Empty>}
          {data && data.total === 0 && !error && (
            <Empty>
              {setId
                ? 'This set is empty. Open a saved position and tick this set, or choose it when saving.'
                : 'No saved positions here yet. Set one up with New position, or press S on the board to save the position in front of you.'}
            </Empty>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
            {data?.positions.map((p, i) => (
              <div key={p.id} className={`group overflow-hidden rounded-xl border bg-surface ${p.id === openId ? 'border-accent' : 'border-line'}`}>
                <button type="button" onClick={() => setOpenId(p.id)} className="block w-full text-left" aria-label={`Open ${p.title}`}>
                  <MiniBoard fen={p.fen} flipped={p.sideToSolve === 'black'} />
                  <div className="space-y-0.5 p-2">
                    <div className="truncate text-sm font-medium">
                      {setId && <span className="mr-1 text-muted">{p.setPlace ?? i + 1}.</span>}
                      {p.title}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {[p.category, ...p.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ') || ' '}
                    </div>
                  </div>
                </button>
                {setId && (
                  <div className="flex justify-between border-t border-line px-2 py-1 text-xs text-muted">
                    <button type="button" disabled={i === 0} onClick={() => void move(i, -1)} className="disabled:opacity-30" aria-label="Move earlier">
                      ← Earlier
                    </button>
                    <button type="button" disabled={i === data.positions.length - 1} onClick={() => void move(i, 1)} className="disabled:opacity-30" aria-label="Move later">
                      Later →
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {data && !setId && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
        </section>

        {setup?.step === 'board' && (
          <BoardEditor
            fen={setup.fen}
            useLabel="Next: its details"
            onUse={(fen) => setSetup({ fen, step: 'details', detailsOpened: true })}
            // Cancelled: back to the details if they were open, otherwise nothing is made.
            onClose={() => setSetup((s) => (s?.detailsOpened ? { ...s, step: 'details' } : null))}
          />
        )}
        {setup?.detailsOpened && (
          <SavePositionDialog
            fen={setup.fen}
            defaults={{ sourceGameId: null, sourcePly: null, sourceLabel: null, answer: null }}
            newPosition={{ hidden: setup.step === 'board', onBack: () => setSetup((s) => s && { ...s, step: 'board' }), setId: setId || undefined }}
            onClose={() => setSetup(null)}
            onSaved={(title, id) => {
              setSetup(null);
              ws.toast(`Saved “${title}”.`);
              reload();
              setOpenId(id);
            }}
          />
        )}

        {openId && (
          <PositionDetail
            key={openId}
            id={openId}
            initial={open}
            sets={sets}
            onClose={() => {
              setOpenId(null);
              if (route.params.get('open')) navigate('positions');
            }}
            onChanged={reload}
          />
        )}
      </div>
    </div>
  );
}

function PositionDetail({
  id,
  initial,
  sets,
  onClose,
  onChanged,
}: {
  id: string;
  initial?: SavedPosition;
  sets: PositionSetSummary[];
  onClose(): void;
  onChanged(): void;
}) {
  const ws = useWorkspace();
  const [saved, setSaved] = useState<SavedPosition | null>(initial ?? null);
  const [showIdea, setShowIdea] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);

  useEffect(() => {
    api.savedPosition(id).then(setSaved).catch((e: Error) => ws.toast(e.message, true));
  }, [id]);

  // The opening it arose from: its game's moves up to it when it was saved from a game's main line,
  // otherwise its own name if the position is a named one (a position set up by hand mostly is not).
  const openings = useOpenings();
  const [gameLine, setGameLine] = useState<string[] | null>(null);
  const sourceGameId = saved?.sourceGameId;
  const sourcePly = saved?.sourcePly;
  const savedKey = saved ? positionKey(saved.fen) : '';
  useEffect(() => {
    setGameLine(null);
    if (!sourceGameId || sourcePly == null) return;
    let live = true;
    api
      .game(sourceGameId)
      .then((detail) => {
        const line = mainlineFrom(parseGame(detail.pgn).root).slice(0, sourcePly + 1);
        if (live && line.length === sourcePly + 1 && positionKey(line.at(-1)!.fen) === savedKey) setGameLine(line.map((n) => n.fen));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sourceGameId, sourcePly, savedKey]);
  const opening = openings && saved ? ((gameLine && openings.classifyOpening(gameLine)) ?? openings.openingAt(saved.fen)) : null;

  if (!saved) return null;

  const update = async (changes: Parameters<typeof api.updateSavedPosition>[1]) => {
    const next = await api.updateSavedPosition(saved.id, changes);
    setSaved(next);
    onChanged();
  };

  const field = `${inputClass} w-full`;

  return (
    <aside className="w-[22rem] shrink-0 space-y-3 overflow-y-auto border-l border-line bg-surface p-4" aria-label="Saved position">
      <div className="flex items-start justify-between gap-2">
        <input
          aria-label="Title"
          defaultValue={saved.title}
          onBlur={(e) => e.target.value.trim() !== saved.title && void update({ title: e.target.value })}
          className="w-full rounded-md border border-transparent bg-transparent px-1 text-base font-semibold outline-none hover:border-line focus:border-accent"
        />
        <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
          ✕
        </button>
      </div>
      <MiniBoard fen={saved.fen} flipped={saved.sideToSolve === 'black'} coordinates />
      <OpeningLabel opening={opening} className="block text-xs" />
      <p className="text-xs text-muted">
        {saved.sideToSolve === 'white' ? 'White' : 'Black'} to play
        {saved.sourceLabel && (
          <>
            {' · '}
            {saved.sourceGameId ? (
              <button type="button" className="text-accent hover:underline" onClick={() => void ws.openGameById(saved.sourceGameId!, saved.sourcePly ?? undefined)}>
                {saved.sourceLabel}
              </button>
            ) : (
              saved.sourceLabel
            )}
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryClass} onClick={() => ws.openFen(saved.fen, saved.sideToSolve)}>
          Open on board
        </button>
        <button type="button" className={buttonClass} onClick={async () => download(await boardPng(saved.fen, saved.sideToSolve === 'black'), `${safeFileName(saved.title)}.png`)}>
          Download image
        </button>
        <button type="button" className={buttonClass} onClick={() => download(new Blob([savedToPgn([saved])], { type: 'application/x-chess-pgn' }), `${safeFileName(saved.title)}.pgn`)}>
          Download PGN
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <label className="space-y-1">
          <span className="text-xs text-muted">Category</span>
          <CategorySelect value={saved.category ?? ''} onChange={(name) => void update({ category: name || null })} allowNew className={field} />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Difficulty</span>
          <select aria-label="Difficulty" className={field} value={saved.difficulty ?? ''} onChange={(e) => void update({ difficulty: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Not set</option>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {'★'.repeat(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-xs text-muted">Tags</span>
          <input aria-label="Tags" className={field} defaultValue={saved.tags.join(', ')} onBlur={(e) => void update({ tags: e.target.value.split(',') })} />
        </label>
        {/* The key idea and the answer give the position away: hidden until asked for (an empty one has
            nothing to give away, so it can be filled in straight away). */}
        <div className="col-span-2 space-y-2 rounded-md border border-line p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Key idea and answer</span>
            {(saved.keyIdea || saved.answer) && (
              <button type="button" className="text-xs text-accent" onClick={() => setShowIdea((s) => !s)}>
                {showIdea ? 'Hide' : 'Show'}
              </button>
            )}
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Key idea</span>
            {showIdea || !saved.keyIdea ? (
              <input aria-label="Key idea" className={field} defaultValue={saved.keyIdea ?? ''} onBlur={(e) => void update({ keyIdea: e.target.value || null })} />
            ) : (
              <div className="rounded-md border border-dashed border-line px-2.5 py-1.5 text-xs text-muted">Hidden</div>
            )}
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-muted">Answer: a move, or a line drilled move by move</span>
            {showIdea || !saved.answer ? (
              <AnswerInput fen={saved.fen} initial={saved.answer ?? ''} className={field} onSave={(answer) => void update({ answer: answer || null })} />
            ) : (
              <div className="rounded-md border border-dashed border-line px-2.5 py-1.5 text-xs text-muted">Hidden</div>
            )}
          </label>
        </div>
        <div className="col-span-2 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Notes</span>
            <button type="button" className="text-xs text-accent" onClick={() => setEditingNotes((s) => !s)}>
              {editingNotes ? 'Done' : 'Edit'}
            </button>
          </div>
          {editingNotes ? (
            <textarea aria-label="Notes" rows={6} className={field} defaultValue={saved.notesMd ?? ''} onBlur={(e) => void update({ notesMd: e.target.value || null })} />
          ) : saved.notesMd ? (
            <Markdown text={saved.notesMd} fen={saved.fen} />
          ) : (
            <p className="text-xs text-muted">No notes.</p>
          )}
        </div>
        <div className="col-span-2 space-y-1">
          <span className="text-xs text-muted">Concepts</span>
          <LinkedConcepts targetType="saved_position" targetId={saved.id} />
        </div>
        <label className="col-span-2 flex items-center gap-2">
          <input type="checkbox" checked={saved.inTraining} onChange={(e) => void update({ inTraining: e.target.checked })} />
          In training
        </label>
        {sets.length > 0 && (
          <fieldset className="col-span-2 space-y-1">
            <legend className="text-xs text-muted">Sets</legend>
            {sets.map((s) => (
              <label key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={saved.setIds.includes(s.id)}
                  onChange={(e) =>
                    void update({ setIds: e.target.checked ? [...saved.setIds, s.id] : saved.setIds.filter((x) => x !== s.id) })
                  }
                />
                {s.name}
              </label>
            ))}
          </fieldset>
        )}
      </div>
      <button
        type="button"
        className={dangerClass}
        onClick={async () => {
          await api.deleteSavedPosition(saved.id);
          undoToast(ws, `Moved “${saved.title}” to the trash.`, () => api.restore('saved_position', saved.id), onChanged);
          onChanged();
          onClose();
        }}
      >
        Delete
      </button>
    </aside>
  );
}

/** The person's categories with their counts: click to filter; add, rename or remove them. */

/** The answer field, with a word when a move in it does not play from the position. */
function AnswerInput({ fen, initial, className, onSave }: { fen: string; initial: string; className: string; onSave(answer: string): void }) {
  const [text, setText] = useState(initial);
  const problem = answerProblem(fen, text);
  return (
    <>
      <input
        aria-label="Answer"
        className={className}
        placeholder="e.g. Bxh7+ Kxh7 Ng5+ (empty: Stockfish judges)"
        value={text}
        aria-invalid={problem !== null}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onSave(text.trim())}
      />
      {problem && <span className="block text-xs text-danger">{problem}</span>}
    </>
  );
}
