import { type MoveNode, createGame, playMove, lineLabel } from '@chess/chess-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ConceptLevel, type ConceptPage, type ConceptSummary, type PositionCategory, api } from '../api.ts';
import { CategorySelect } from '../components/CategorySelect.tsx';
import { LEVEL_NAMES, LevelMark, LevelPicker } from '../components/Level.tsx';
import { Board } from '../Board.tsx';
import { paletteSources } from '../components/CommandPalette.tsx';
import { ConceptPicker } from '../components/ConceptPicker.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { MiniBoard } from '../components/MiniBoard.tsx';
import { Empty, PageHeader, buttonClass, dangerClass, inputClass, primaryClass } from '../components/ui.tsx';
import { navigate, setLeaveGuard, useRoute } from '../router.ts';
import { useAskText } from '../components/AskText.tsx';
import { undoToast, useWorkspace } from '../workspace.tsx';
import { ConceptsSidebar } from './ConceptsSidebar.tsx';

// Concepts are found from Ctrl+K too.
paletteSources.push(async (q) =>
  (await api.concepts({ q })).slice(0, 6).map((c) => ({
    key: `c${c.id}`,
    label: c.title,
    hint: 'Concept',
    run: () => navigate(`concepts/${c.id}`),
  })),
);

export function ConceptsScreen() {
  const ws = useWorkspace();
  const route = useRoute();
  const id = route.parts[1];
  const [q, setQ] = useState('');
  const [list, setList] = useState<ConceptSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const askText = useAskText();
  // The person's own categories, in their order.
  const [categories, setCategories] = useState<PositionCategory[]>([]);
  const [missingStarters, setMissingStarters] = useState(0);
  useEffect(() => {
    api
      .missingStarterConcepts()
      .then((r) => setMissingStarters(r.missing))
      .catch(() => {});
  }, [refresh]);

  // The concepts and their categories, read together so they always agree (a renamed category never
  // shows empty while the concepts catch up). Typing waits a moment; anything else reads at once.
  const searched = useRef(q);
  useEffect(() => {
    let live = true;
    const typing = searched.current !== q;
    searched.current = q;
    const timer = setTimeout(
      () => {
        Promise.all([api.concepts({ q: q.trim() || undefined }), api.conceptCategories()])
          .then(([l, c]) => {
            if (!live) return;
            setList(l);
            setCategories(c);
          })
          .catch((e: Error) => live && setError(e.message));
      },
      typing ? 120 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, refresh]);

  const create = async () => {
    // A title already in the library, or too long, is refused in the box, which stays open.
    const made: { id?: string } = {};
    await askText('New concept', '', 'e.g. Minority attack', async (text) => {
      if (text.trim()) made.id = (await api.createConcept({ title: text.trim() })).id;
    });
    if (!made.id) return;
    reload();
    navigate(`concepts/${made.id}?edit=1`);
  };
  const addStarters = async () => {
    try {
      const { added } = await api.addStarterConcepts();
      ws.toast(added ? `Added ${added} starter concept${added === 1 ? '' : 's'}.` : 'Your library already has every starter concept.');
      reload();
    } catch (error) {
      ws.toast((error as Error).message, true);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Concepts">
        {/* Only while some of the concepts that come with the app are not in the library (deleted, or an
            older library). */}
        {missingStarters > 0 && (
          <button
            type="button"
            className={buttonClass}
            title="The chess concepts that come with the app, from forks to the Lucena position: adds any your library does not have. Your own concepts are left as they are."
            onClick={() => void addStarters()}
          >
            Add {missingStarters} missing starter concept{missingStarters === 1 ? '' : 's'}
          </button>
        )}
        <button type="button" className={primaryClass} onClick={() => void create()}>
          New concept
        </button>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <ConceptsSidebar list={list} categories={categories} q={q} onSearch={setQ} error={error} currentId={id} onChanged={reload} />
        <section className="min-w-0 flex-1 overflow-y-auto p-6">
          {id ? (
            <ConceptView key={id} id={id} startEditing={route.params.get('edit') === '1'} onChanged={reload} />
          ) : (
            <Empty>
              Pick a concept, or create one: a pawn structure, a plan, a motif, an endgame technique. In its text, a
              FEN on a line of its own becomes a board, moves like 1. e4 e5 become links, and **bold**, *italics* and
              - lists work as in a chat message.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function ConceptView({ id, startEditing, onChanged }: { id: string; startEditing: boolean; onChanged(): void }) {
  const ws = useWorkspace();
  const [page, setPage] = useState<ConceptPage | null>(null);
  const [editing, setEditing] = useState(startEditing);
  const [drilling, setDrilling] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.concept(id).then(setPage).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (error) return <Empty>{error}</Empty>;
  if (!page) return null;

  if (editing) {
    return (
      <ConceptEditor
        page={page}
        onDone={(next) => {
          // Cancelled: related concepts are linked as they are chosen, so the page is read again.
          if (next) setPage(next);
          else load();
          setEditing(false);
          onChanged();
          if (startEditing) navigate(`concepts/${id}`);
        }}
      />
    );
  }

  const category = page.category;
  const linkedCount = page.savedPositions.length + page.positions.length;

  return (
    <article className="mx-auto max-w-3xl space-y-5">
      <header className="space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{page.title}</h1>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className={buttonClass} disabled={!linkedCount} title={linkedCount ? 'A random linked position' : 'Link a position first'} onClick={() => setDrilling(true)}>
              Drill
            </button>
          </div>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted">
          {page.level && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text">
              <LevelMark level={page.level} className="text-accent" />
              {LEVEL_NAMES[page.level]}
            </span>
          )}
          <span>{[category, page.aliases.length ? `also: ${page.aliases.join(', ')}` : null, ...page.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}</span>
        </p>
      </header>

      {drilling && <ConceptDrill conceptId={page.id} onReveal={setRevealed} onClose={() => setDrilling(false)} />}
      {drilling && !revealed && <p className="text-sm text-muted">The page stays hidden until you play a move.</p>}
      {(!drilling || revealed) && (
      <>

      {page.keySigns.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Key signs</h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {page.keySigns.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </section>
      )}

      {page.bodyMd ? <Markdown text={page.bodyMd} /> : <p className="text-sm text-muted">Nothing written yet. Edit to write it up.</p>}

      {page.related.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Related</h2>
          <div className="flex flex-wrap gap-1">
            {page.related.map((r) => (
              <a key={r.id} href={`#/concepts/${r.id}`} className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm hover:underline">
                {r.title}
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Positions ({linkedCount})</h2>
        {linkedCount === 0 && <p className="text-sm text-muted">Link saved positions from the Positions screen or the save box, or positions from the board’s Saved tab.</p>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
          {page.savedPositions.map((s) => (
            <button key={s.id} type="button" onClick={() => navigate(`positions?open=${s.id}`)} className="overflow-hidden rounded-lg border border-line bg-surface text-left">
              <MiniBoard fen={s.fen} flipped={s.sideToSolve === 'black'} />
              <div className="truncate px-2 py-1 text-xs">{s.title}</div>
            </button>
          ))}
          {page.positions.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-line bg-surface">
              <button type="button" onClick={() => ws.openFen(p.fen)} className="block w-full">
                <MiniBoard fen={p.fen} flipped={p.fen.split(' ')[1] === 'b'} />
              </button>
              <button
                type="button"
                className="w-full px-2 py-1 text-left text-xs text-muted hover:text-danger"
                onClick={async () => {
                  await api.unlinkConcept(page.id, 'position', p.id);
                  load();
                }}
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      </section>

      {page.games.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Games</h2>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-sm">
            {page.games.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => void ws.openGameById(g.id)} className="w-full px-3 py-1.5 text-left hover:bg-surface-2">
                  {g.white} – {g.black} <span className="text-muted">{g.result} {g.date?.slice(0, 4)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {page.repertoireMoves.length > 0 && (
        <section className="space-y-1">
          <h2 className="text-sm font-semibold">Repertoire moves</h2>
          <ul className="text-sm">
            {page.repertoireMoves.map((m) => (
              <li key={m.id}>
                <button type="button" className="hover:text-accent" onClick={() => ws.openFen(m.fen)}>
                  {m.san}
                </button>{' '}
                <span className="text-muted">
                  in {m.repertoire} ({m.color})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      </>
      )}

      <button
        type="button"
        className={dangerClass}
        onClick={async () => {
          await api.deleteConcept(page.id);
          undoToast(ws, `Moved “${page.title}” to the trash.`, () => api.restore('concept', page.id), () => {
            onChanged();
            navigate(`concepts/${page.id}`);
          });
          onChanged();
          navigate('concepts');
        }}
      >
        Delete concept
      </button>
    </article>
  );
}

function ConceptEditor({ page, onDone }: { page: ConceptPage; onDone(next?: ConceptPage): void }) {
  const ws = useWorkspace();
  const [title, setTitle] = useState(page.title);
  const [aliases, setAliases] = useState(page.aliases.join(', '));
  const [category, setCategory] = useState(page.category ?? '');
  const [level, setLevel] = useState<ConceptLevel | null>(page.level);
  const [tags, setTags] = useState(page.tags.join(', '));
  const [keySigns, setKeySigns] = useState(page.keySigns.join('\n'));
  const [body, setBody] = useState(page.bodyMd ?? '');
  const [preview, setPreview] = useState(false);
  const [related, setRelated] = useState<ConceptSummary[]>(page.related);
  // Unsaved text: leaving for another screen or concept asks first (router.ts).
  const dirty =
    title !== page.title ||
    aliases !== page.aliases.join(', ') ||
    category !== (page.category ?? '') ||
    level !== page.level ||
    tags !== page.tags.join(', ') ||
    keySigns !== page.keySigns.join('\n') ||
    body !== (page.bodyMd ?? '');
  useEffect(() => (dirty ? setLeaveGuard(() => `Your changes to “${page.title}” are not saved.`) : undefined), [dirty, page.title]);

  const save = async () => {
    if (!title.trim()) return ws.toast('A concept needs a title.', true);
    try {
      const next = await api.updateConcept(page.id, {
        title: title.trim(),
        aliases: aliases.split(','),
        category: category || null,
        level,
        tags: tags.split(','),
        keySigns: keySigns.split('\n'),
        bodyMd: body.trim() || null,
      });
      ws.dismissMessage(); // an earlier "needs a title" no longer applies
      onDone(next);
    } catch (e) {
      ws.toast((e as Error).message, true);
    }
  };

  const field = `${inputClass} w-full`;
  return (
    <form
      className="mx-auto max-w-3xl space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input aria-label="Title" required maxLength={200} className={`${field} text-lg font-semibold`} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="space-y-1">
          <span className="text-muted">Also known as (commas)</span>
          <input aria-label="Aliases" className={field} value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <label className="space-y-1">
          <span className="text-muted">Category</span>
          <CategorySelect kind="concept" value={category} onChange={setCategory} noneLabel="Not categorised" allowNew className={field} />
        </label>
        <div className="space-y-1">
          <span className="text-muted">Level</span>
          <LevelPicker value={level} onChange={setLevel} />
        </div>
        <label className="space-y-1">
          <span className="text-muted">Tags (commas)</span>
          <input aria-label="Tags" className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="text-muted">Key signs: what to look for, one per line</span>
          <textarea aria-label="Key signs" rows={3} className={field} value={keySigns} onChange={(e) => setKeySigns(e.target.value)} />
        </label>
      </div>
      <div className="space-y-1 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted">Text (markdown; a FEN on its own line becomes a board, ```line blocks become boards too)</span>
          <button type="button" className="text-accent" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Write' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md border border-line bg-surface p-3">
            <Markdown text={body} />
          </div>
        ) : (
          <textarea aria-label="Text" rows={14} className={`${field} font-mono`} value={body} onChange={(e) => setBody(e.target.value)} />
        )}
      </div>
      <div className="space-y-1 text-sm">
        <span className="text-muted">Related concepts</span>
        <ConceptPicker
          linked={related}
          placeholder="Add a related concept…"
          onAdd={async (c) => {
            await api.linkConcept(page.id, 'concept', { targetId: c.id });
            setRelated((r) => [...r, c]);
          }}
          onRemove={async (c) => {
            await api.unlinkConcept(page.id, 'concept', c.id);
            setRelated((r) => r.filter((x) => x.id !== c.id));
          }}
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" className={primaryClass}>
          Save
        </button>
        <button type="button" className={buttonClass} onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A random position linked to the concept: play the idea, then the page is revealed. */
function ConceptDrill({ conceptId, onReveal, onClose }: { conceptId: string; onReveal(shown: boolean): void; onClose(): void }) {
  const [drill, setDrill] = useState<Awaited<ReturnType<typeof api.conceptDrill>> | null>(null);
  const [node, setNode] = useState<MoveNode | null>(null);
  const [played, setPlayed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const next = useCallback(() => {
    setPlayed([]);
    onReveal(false);
    api
      .conceptDrill(conceptId)
      .then((d) => {
        setDrill(d);
        setNode(createGame(d.fen).root);
      })
      .catch((e: Error) => setError(e.message));
  }, [conceptId, onReveal]);
  useEffect(next, [next]);

  if (error) return <Empty>{error}</Empty>;
  if (!drill || !node) return null;
  const color = drill.fen.split(' ')[1] === 'b' ? 'black' : 'white';
  const start = createGame(drill.fen).root;
  return (
    <section className="space-y-3 rounded-xl border border-accent bg-surface p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Drill: {color === 'white' ? 'White' : 'Black'} to play. Show the idea.</h2>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} onClick={next}>
            Another
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              onReveal(false);
              onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="w-full max-w-sm">
          <Board
            node={node}
            orientation={color}
            onMove={(from, to, promotion) => {
              try {
                const m = playMove(node, promotion ? { from, to, promotion } : { from, to });
                setNode(m);
                setPlayed((p) => [...p, m.san]);
                onReveal(true);
              } catch {
                setNode({ ...node });
              }
            }}
            onShapes={() => {}}
          />
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-muted">{drill.title}</p>
          {played.length > 0 && (
            <>
              <p>
                You played <strong>{lineLabel(played.map((s, i) => ({ ply: start.ply + i + 1, san: s })))}</strong>.
                {drill.answer && (
                  <>
                    {' '}
                    The saved answer is <strong>{drill.answer}</strong>.
                  </>
                )}
              </p>
              <p className="text-muted">The concept page is below: does your move carry the idea?</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
