import { formatTimeControl } from '@chess/chess-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CollectionSummary, type GameSort, type GameSummary, type ImportProgress, type ImportReport, api } from '../api.ts';
import { Modal } from '../Dialogs.tsx';
import { Empty, PageHeader, Pager, SideList, buttonClass, dangerClass, inputClass, primaryClass } from '../components/ui.tsx';
import { undoToast, useWorkspace } from '../workspace.tsx';
import { navigate, useRoute } from '../router.ts';
import { useAskText } from '../components/AskText.tsx';
import { readTextFile } from '../files.ts';
import { download, safeFileName } from '../pieces.ts';

const LIMIT = 50;
/** The sidebar entry for the games of the last import, beside the collections. */
const LAST_IMPORT = 'last-import';

interface Filters {
  q: string;
  player: string;
  opening: string;
  result: string;
  dateFrom: string;
  dateTo: string;
  tag: string;
  myColor: string;
  speed: string;
  timeControl: string;
}

const EMPTY: Filters = { q: '', player: '', opening: '', result: '', dateFrom: '', dateTo: '', tag: '', myColor: '', speed: '', timeControl: '' };

const SPEED_LABELS: Record<string, string> = {
  ultrabullet: 'UltraBullet',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
  correspondence: 'Correspondence',
};

export function GamesScreen() {
  const ws = useWorkspace();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);
  // A column to sort by; none means the newest first (a collection: its own order).
  const [sort, setSort] = useState<{ key: GameSort; dir: 'asc' | 'desc' } | null>(null);
  const [data, setData] = useState<{ total: number; games: GameSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<GameSummary | null>(null);
  const [findingDuplicates, setFindingDuplicates] = useState(false);
  const [controls, setControls] = useState<{ timeControl: string; speed: string | null; games: number }[]>([]);
  // The row the keyboard is on: arrows move it, Enter opens, Space selects, E edits, Delete deletes.
  const [focusRow, setFocusRow] = useState(0);
  const rows = useRef<(HTMLTableRowElement | null)[]>([]);
  // Set when a key changed the list (a page turned, a game deleted): the keyboard stays in it.
  const refocus = useRef(false);

  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const [lastImportCount, setLastImportCount] = useState(0);
  // "Show all" from the board's Games tab: only the games that reached that position.
  const fen = useRoute().params.get('fen') ?? '';
  const scope = {
    collectionId: collectionId && collectionId !== LAST_IMPORT ? collectionId : undefined,
    lastImport: collectionId === LAST_IMPORT ? (1 as const) : undefined,
    fen: fen || undefined,
  };
  const askText = useAskText();

  useEffect(() => {
    api.collections().then(setCollections).catch(() => {});
    api.timeControls().then(setControls).catch(() => {});
    api
      .games({ lastImport: 1, limit: 1 })
      .then((d) => setLastImportCount(d.total))
      .catch(() => {});
  }, [refresh]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api
        .games({
          ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
          ...scope,
          sort: sort?.key,
          dir: sort?.dir,
          limit: LIMIT,
          offset,
        })
        .then((d) => {
          if (!live) return;
          setData(d);
          setError(null);
        })
        .catch((e: Error) => live && setError(e.message));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [filters, collectionId, offset, refresh, sort, fen]);

  // A selection belongs to the rows on screen: a new filter, collection or page starts afresh, so a
  // bulk action can never reach games that are no longer visible.
  useEffect(() => {
    setSelected(new Set());
  }, [filters, collectionId, offset, fen]);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setOffset(0);
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newCollection = async () => {
    const name = await askText('New collection', '', 'e.g. My best games');
    if (!name?.trim()) return;
    const { id } = await api.createCollection(name.trim());
    if (selected.size) await api.addToCollection(id, [...selected]);
    setCollectionId(id);
    reload();
  };

  const current = collections.find((c) => c.id === collectionId);

  const deleteOne = async (game: GameSummary) => {
    refocus.current = true;
    await api.deleteGames([game.id]);
    undoToast(ws, 'Moved the game to the trash.', () => api.restore('game', game.id), reload);
    reload();
  };

  useEffect(() => {
    if (!refocus.current || !data?.games.length) return;
    refocus.current = false;
    rows.current[Math.min(focusRow, data.games.length - 1)]?.focus();
  }, [data]);

  const onRowKey = (event: React.KeyboardEvent, index: number, game: GameSummary) => {
    const count = data?.games.length ?? 0;
    const go = (next: number) => {
      const row = Math.min(Math.max(next, 0), count - 1);
      setFocusRow(row);
      rows.current[row]?.focus();
    };
    const actions: Record<string, () => void> = {
      ArrowDown: () => go(index + 1),
      ArrowUp: () => go(index - 1),
      Home: () => go(0),
      End: () => go(count - 1),
      PageDown: () => {
        if (!data || offset + LIMIT >= data.total) return;
        refocus.current = true;
        setFocusRow(0);
        setOffset(offset + LIMIT);
      },
      PageUp: () => {
        if (offset === 0) return;
        refocus.current = true;
        setFocusRow(0);
        setOffset(Math.max(0, offset - LIMIT));
      },
      Enter: () => void ws.openGameById(game.id),
      ' ': () => toggle(game.id),
      e: () => setEditing(game),
      Delete: () => void deleteOne(game),
    };
    const action = actions[event.key];
    if (action && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      action();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Games">
        <button
          type="button"
          className={buttonClass}
          disabled={!data?.total}
          title="All the games listed, on every page, as one PGN file"
          onClick={async () => {
            try {
              const { pgn, count } = await api.exportGames({
                ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
                ...scope,
                sort: sort?.key,
                dir: sort?.dir,
              });
              download(new Blob([pgn], { type: 'application/x-chess-pgn' }), `${safeFileName(current?.name ?? 'games')}-${new Date().toISOString().slice(0, 10)}.pgn`);
              ws.toast(`Exported ${count} game${count === 1 ? '' : 's'}.`);
            } catch (error) {
              ws.toast((error as Error).message, true);
            }
          }}
        >
          Export PGN{data?.total ? ` (${data.total})` : ''}
        </button>
        <button type="button" className={buttonClass} disabled={!data?.total} onClick={() => setFindingDuplicates(true)} title="Games that are in the library more than once">
          Find duplicates
        </button>
        <button type="button" className={primaryClass} onClick={() => setImporting(true)}>
          Import games
        </button>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <aside className="w-48 shrink-0 space-y-3 overflow-y-auto border-r border-line p-3 xl:w-56">
          <SideList
            items={[
              // The library's count, not a filter's: none while a filter is on.
              { id: '', label: 'All games', count: collectionId || fen || Object.values(filters).some(Boolean) ? undefined : data?.total },
              ...(lastImportCount ? [{ id: LAST_IMPORT, label: 'Last import', count: lastImportCount }] : []),
              ...collections.map((c) => ({ id: c.id, label: c.name, count: c.games })),
            ]}
            activeId={collectionId}
            onSelect={(id) => {
              setCollectionId(id);
              setOffset(0);
              setSelected(new Set());
            }}
          />
          <button type="button" className="px-2.5 text-sm text-accent" onClick={() => void newCollection()}>
            + New collection{selected.size ? ` with ${selected.size} selected` : ''}
          </button>
          {current && (
            <div className="flex gap-2 px-2.5 text-xs">
              <button
                type="button"
                className="text-muted hover:text-text"
                onClick={async () => {
                  const name = await askText('Rename collection', current.name);
                  if (name?.trim()) {
                    await api.renameCollection(current.id, name.trim());
                    reload();
                  }
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="text-danger"
                onClick={async () => {
                  await api.deleteCollection(current.id);
                  setCollectionId('');
                  reload();
                  undoToast(ws, `Moved “${current.name}” to the trash. Its games stay in the library.`, () => api.restore('collection', current.id), () => {
                    setCollectionId(current.id);
                    reload();
                  });
                }}
              >
                Delete collection
              </button>
            </div>
          )}
        </aside>

        <section className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex flex-wrap gap-2">
            <input
              aria-label="Search games"
              className={`${inputClass} w-56`}
              placeholder="Search players, event, opening…"
              value={filters.q}
              onChange={(e) => setFilter('q', e.target.value)}
              onKeyDown={(e) => {
                // Down from the search box goes into the list, for the keyboard.
                if (e.key === 'ArrowDown' && rows.current[0]) {
                  e.preventDefault();
                  setFocusRow(0);
                  rows.current[0].focus();
                }
              }}
            />
            <input aria-label="Player" className={`${inputClass} w-36`} placeholder="Player" value={filters.player} onChange={(e) => setFilter('player', e.target.value)} />
            <input aria-label="Opening or ECO" className={`${inputClass} w-36`} placeholder="Opening or ECO" value={filters.opening} onChange={(e) => setFilter('opening', e.target.value)} />
            <select aria-label="Result" className={inputClass} value={filters.result} onChange={(e) => setFilter('result', e.target.value)}>
              <option value="">Any result</option>
              <option value="1-0">1-0</option>
              <option value="0-1">0-1</option>
              <option value="1/2-1/2">½-½</option>
              <option value="*">Unfinished</option>
            </select>
            <select aria-label="My colour" className={inputClass} value={filters.myColor} onChange={(e) => setFilter('myColor', e.target.value)}>
              <option value="">Any colour</option>
              <option value="white">I had White</option>
              <option value="black">I had Black</option>
            </select>
            <select aria-label="Speed" className={inputClass} value={filters.speed} onChange={(e) => setFilter('speed', e.target.value)}>
              <option value="">Any speed</option>
              {Object.entries(SPEED_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {controls.length > 0 && (
              <select aria-label="Time control" className={inputClass} value={filters.timeControl} onChange={(e) => setFilter('timeControl', e.target.value)}>
                <option value="">Any time control</option>
                {controls
                  .filter((c) => !filters.speed || c.speed === filters.speed)
                  .map((c) => (
                    <option key={c.timeControl} value={c.timeControl}>
                      {formatTimeControl(c.timeControl)} ({c.games})
                    </option>
                  ))}
              </select>
            )}
            <input aria-label="From date" type="date" className={inputClass} value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} />
            <input aria-label="To date" type="date" className={inputClass} value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} />
            <input aria-label="Tag" className={`${inputClass} w-28`} placeholder="Tag" value={filters.tag} onChange={(e) => setFilter('tag', e.target.value)} />
            {Object.values(filters).some(Boolean) && (
              <button type="button" className="text-sm text-muted hover:text-text" onClick={() => setFilters(EMPTY)}>
                Clear
              </button>
            )}
          </div>

          {fen && (
            <div className="flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              <span>Only games that reached the position from the board.</span>
              <button type="button" className="ml-auto text-accent hover:underline" onClick={() => navigate('games')}>
                Show all games
              </button>
            </div>
          )}

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              <span>{selected.size} selected</span>
              <select
                aria-label="Add to collection"
                className={inputClass}
                value=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await api.addToCollection(e.target.value, [...selected]);
                  ws.toast(`Added ${selected.size} game${selected.size === 1 ? '' : 's'} to the collection.`);
                  reload();
                }}
              >
                <option value="">Add to collection…</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {current && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={async () => {
                    const ids = [...selected];
                    await api.removeFromCollection(current.id, ids);
                    setSelected(new Set());
                    reload();
                    undoToast(ws, `Took ${ids.length} game${ids.length === 1 ? '' : 's'} out of “${current.name}”.`, () => api.addToCollection(current.id, ids), reload);
                  }}
                >
                  Remove from “{current.name}”
                </button>
              )}
              <button
                type="button"
                className={buttonClass}
                onClick={async () => {
                  const { pgn, count } = await api.exportGameIds([...selected]);
                  download(new Blob([pgn], { type: 'application/x-chess-pgn' }), `selected-games-${new Date().toISOString().slice(0, 10)}.pgn`);
                  ws.toast(`Exported ${count} game${count === 1 ? '' : 's'}.`);
                }}
              >
                Export selected
              </button>
              <button
                type="button"
                className={dangerClass}
                onClick={async () => {
                  const ids = [...selected];
                  await api.deleteGames(ids);
                  undoToast(ws, `Moved ${ids.length} game${ids.length === 1 ? '' : 's'} to the trash.`, () => api.restore('game', ids), reload);
                  setSelected(new Set());
                  reload();
                }}
              >
                Delete
              </button>
              <button type="button" className="ml-auto text-muted" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          {error && <Empty>{error}</Empty>}
          {data && data.total === 0 && !error && (
            <Empty>
              {Object.values(filters).some(Boolean) || collectionId
                ? 'No game matches.'
                : 'No games yet. Import a PGN file, or your games from Lichess or Chess.com.'}
            </Empty>
          )}
          {data && data.total > 0 && (
            <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={data.games.length > 0 && data.games.every((g) => selected.has(g.id))}
                        onChange={(e) =>
                          setSelected(e.target.checked ? new Set(data.games.map((g) => g.id)) : new Set())
                        }
                      />
                    </th>
                    {COLUMNS.map((column) => (
                      <SortHeader
                        key={column.key}
                        column={column}
                        sort={sort}
                        ownOrder={!!scope.collectionId}
                        onSort={(next) => {
                          setSort(next);
                          setOffset(0);
                        }}
                      />
                    ))}
                    <th className="w-12 px-2 py-2">
                      <span className="sr-only">Edit</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.games.map((g, i) => (
                    <tr
                      key={g.id}
                      ref={(el) => {
                        rows.current[i] = el;
                      }}
                      tabIndex={i === Math.min(focusRow, data.games.length - 1) ? 0 : -1}
                      aria-label={`${g.white ?? '?'} – ${g.black ?? '?'}, ${g.result}`}
                      className="cursor-pointer outline-none hover:bg-surface-2 focus-visible:bg-accent-soft"
                      onClick={() => void ws.openGameById(g.id)}
                      onFocus={() => setFocusRow(i)}
                      onKeyDown={(e) => onRowKey(e, i, g)}
                    >
                      <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Select game" checked={selected.has(g.id)} onChange={() => toggle(g.id)} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted">{g.date?.replace(/\.\?\?/g, '') ?? ''}</td>
                      <td className={`px-2 py-1.5 ${g.myColor === 'white' ? 'font-semibold' : ''}`}>
                        {g.white ?? '?'} {g.whiteElo && <span className="text-xs text-muted">{g.whiteElo}</span>}
                      </td>
                      <td className={`px-2 py-1.5 ${g.myColor === 'black' ? 'font-semibold' : ''}`}>
                        {g.black ?? '?'} {g.blackElo && <span className="text-xs text-muted">{g.blackElo}</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{g.result === '1/2-1/2' ? '½-½' : g.result}</td>
                      <td className="max-w-64 truncate px-2 py-1.5">
                        {g.eco && <span className="mr-1 text-xs text-muted">{g.eco}</span>}
                        {g.openingName}
                      </td>
                      <td className="max-w-48 truncate px-2 py-1.5 text-muted">
                        {g.timeControl && formatTimeControl(g.timeControl) && (
                          <span className="mr-1.5 tabular-nums" title={g.speed ? SPEED_LABELS[g.speed] : undefined}>
                            {formatTimeControl(g.timeControl)}
                          </span>
                        )}
                        {g.event}
                        {g.tags.map((t) => (
                          <span key={t} className="ml-1 rounded bg-surface-2 px-1 text-xs">
                            #{t}
                          </span>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          tabIndex={-1}
                          className="text-xs text-muted hover:text-accent"
                          title="Notes, tags and my colour (E)"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(g);
                          }}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && data.total > 0 && (
            <p className="text-xs text-muted">
              <kbd>↑</kbd> <kbd>↓</kbd> move through the list, <kbd>Enter</kbd> opens, <kbd>Space</kbd> selects, <kbd>E</kbd> edits,{' '}
              <kbd>Delete</kbd> moves to the trash, <kbd>PgUp</kbd> <kbd>PgDn</kbd> turn the page.
            </p>
          )}
          {data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
        </section>
      </div>

      {findingDuplicates && (
        <DuplicatesDialog
          onClose={() => setFindingDuplicates(false)}
          onRemoved={(ids) => {
            undoToast(ws, `Moved ${ids.length} extra cop${ids.length === 1 ? 'y' : 'ies'} to the trash.`, () => api.restore('game', ids), reload);
            reload();
          }}
        />
      )}
      {editing && (
        <GameDetailsDialog
          game={editing}
          onClose={() => {
            setEditing(null);
            rows.current[focusRow]?.focus();
          }}
          onSaved={() => {
            ws.toast('Saved.');
            reload();
          }}
        />
      )}
      {importing && (
        <ImportGamesDialog
          collections={collections}
          defaultCollection={collectionId === LAST_IMPORT ? '' : collectionId}
          onClose={() => setImporting(false)}
          onDone={(report) => {
            // Show what came in, all of it (a filter left on could hide it).
            if (report.imported > 0 && !collectionId) {
              setCollectionId(LAST_IMPORT);
              setFilters(EMPTY);
              setOffset(0);
            }
            reload();
            ws.toast(importSummary(report), report.errors.length > 0 && report.imported === 0);
          }}
        />
      )}
    </div>
  );
}

export function importSummary(report: ImportReport): string {
  const parts = [`Imported ${report.imported} game${report.imported === 1 ? '' : 's'}`];
  if (report.duplicates) parts.push(`${report.duplicates} already in the library`);
  if (report.variants) parts.push(`${report.variants} left out (not standard chess)`);
  if (report.errors.length) parts.push(`${report.errors.length} could not be read (first: line ${report.errors[0]!.line}, ${report.errors[0]!.message})`);
  return `${parts.join(', ')}.`;
}

type Source = 'pgn' | 'lichess' | 'chesscom';

function ImportGamesDialog({
  collections,
  defaultCollection,
  onClose,
  onDone,
}: {
  collections: CollectionSummary[];
  defaultCollection: string;
  onClose(): void;
  onDone(report: ImportReport): void;
}) {
  const [source, setSource] = useState<Source>('pgn');
  const [text, setText] = useState('');
  const [username, setUsername] = useState('');
  // The name Settings knows as mine on this site; an import of anyone else's games leaves it alone.
  const [myName, setMyName] = useState('');
  const [mine, setMine] = useState(true);
  const [max, setMax] = useState(500);
  const [collectionId, setCollectionId] = useState(defaultCollection);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        const name = (source === 'lichess' ? s.lichessUsername : source === 'chesscom' ? s.chesscomUsername : '') ?? '';
        setMyName(name);
        setUsername(name);
        setMine(true);
      })
      .catch(() => {});
  }, [source]);

  const changeUsername = (value: string) => {
    setUsername(value);
    // Ticked for my own name, or while no name is known yet; unticked for somebody else's.
    setMine(!myName || value.trim().toLowerCase() === myName.trim().toLowerCase());
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const target = collectionId || undefined;
      const report =
        source === 'pgn'
          ? await api.importPgn(text, target, setProgress)
          : source === 'lichess'
            ? await api.importLichess(username, max, target, mine, setProgress)
            : await api.importChesscom(username, max, target, mine, setProgress);
      onDone(report);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal title="Import games" onClose={onClose}>
      <div className="mb-3 flex gap-1 text-sm" role="tablist">
        {(
          [
            ['pgn', 'PGN file or text'],
            ['lichess', 'Lichess'],
            ['chesscom', 'Chess.com'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={source === id}
            onClick={() => setSource(id)}
            className={`rounded-md px-3 py-1.5 ${source === id ? 'bg-accent-soft font-semibold' : 'hover:bg-surface-2'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === 'pgn' ? (
        <div className="space-y-2">
          <textarea
            aria-label="PGN"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            spellCheck={false}
            placeholder="Paste one or many games here, or open a file."
            className={`${inputClass} w-full font-mono`}
          />
          <label className={`${buttonClass} inline-block cursor-pointer`}>
            Open .pgn file…
            <input
              type="file"
              accept=".pgn,.txt"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setText(await readTextFile(file));
              }}
            />
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm">
            <span className="block text-muted">{source === 'lichess' ? 'Lichess' : 'Chess.com'} username</span>
            <input aria-label="Username" value={username} onChange={(e) => changeUsername(e.target.value)} className={inputClass} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block text-muted">Most recent games</span>
            <input aria-label="How many games" type="number" min={1} max={5000} value={max} onChange={(e) => setMax(Number(e.target.value))} className={`${inputClass} w-28`} />
          </label>
          <label className="flex w-full items-center gap-2 text-sm">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            These are my games
            <span className="text-xs text-muted">(remembers the name as mine, so my colour is filled in)</span>
          </label>
          <p className="w-full text-xs text-muted">
            Games already in the library are skipped, so importing again only adds new ones. Only standard chess
            comes in, no variants.
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <select aria-label="Into collection" className={inputClass} value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
          <option value="">No collection</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              Into “{c.name}”
            </option>
          ))}
        </select>
        <button
          type="button"
          className={primaryClass}
          disabled={busy || (source === 'pgn' ? !text.trim() : !username.trim())}
          onClick={() => void run()}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
      {busy && <ImportProgressLine progress={progress} />}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Modal>
  );
}

/** The list's columns; a click sorts by one, a second click turns the order round. */
const COLUMNS: { key: GameSort; label: string; first: 'asc' | 'desc' }[] = [
  { key: 'date', label: 'Date', first: 'desc' },
  { key: 'white', label: 'White', first: 'asc' },
  { key: 'black', label: 'Black', first: 'asc' },
  { key: 'result', label: 'Result', first: 'asc' },
  { key: 'eco', label: 'Opening', first: 'asc' },
  { key: 'event', label: 'Event', first: 'asc' },
];

function SortHeader({
  column,
  sort,
  ownOrder = false,
  onSort,
}: {
  column: (typeof COLUMNS)[number];
  sort: { key: GameSort; dir: 'asc' | 'desc' } | null;
  /** A collection in its own order: no column is the sort until one is chosen. */
  ownOrder?: boolean;
  onSort(next: { key: GameSort; dir: 'asc' | 'desc' }): void;
}) {
  const newestFirst = !sort && !ownOrder && column.key === 'date';
  const active = sort?.key === column.key || newestFirst;
  const dir = sort?.key === column.key ? sort.dir : newestFirst ? 'desc' : null;
  return (
    <th className="px-2 py-2" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        className={`inline-flex items-center gap-1 hover:text-text ${active ? 'text-text' : ''}`}
        onClick={() => onSort({ key: column.key, dir: dir ? (dir === 'asc' ? 'desc' : 'asc') : column.first })}
      >
        {column.label}
        <span aria-hidden className="w-2 text-[10px]">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}
        </span>
      </button>
    </th>
  );
}

/** "Downloading… 120 of 500 games", then "Importing… 1,234 of 5,000 games", with a bar when the end is known. */
function ImportProgressLine({ progress }: { progress: ImportProgress | null }) {
  const n = (x: number) => x.toLocaleString('en');
  const { phase = 'importing', games = 0, expected } = progress ?? {};
  const total = expected && expected >= games ? expected : undefined;
  const label = !progress
    ? 'Starting…'
    : `${phase === 'downloading' ? 'Downloading' : 'Importing'}… ${n(games)}${total ? ` of ${phase === 'downloading' ? 'up to ' : ''}${n(total)}` : ''} games`;
  return (
    <div className="mt-3 space-y-1 text-xs text-muted" aria-live="polite">
      {total ? (
        <div role="progressbar" aria-label="Import progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={games} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round((games / total) * 100)}%` }} />
        </div>
      ) : null}
      <p>{label}</p>
    </div>
  );
}

/** A game's notes, tags and which side I played, edited from the library. */
function GameDetailsDialog({ game, onClose, onSaved }: { game: GameSummary; onClose(): void; onSaved(): void }) {
  const ws = useWorkspace();
  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState(game.tags.join(', '));
  const [myColor, setMyColor] = useState<string>(game.myColor ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .game(game.id)
      .then((detail) => setNotes(detail.notes ?? ''))
      .catch((e: Error) => setError(e.message));
  }, [game.id]);

  const save = async () => {
    try {
      await api.updateGame(game.id, {
        notes: notes?.trim() ? notes.trim() : null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        myColor: myColor === 'white' || myColor === 'black' ? myColor : null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title={`${game.white ?? '?'} – ${game.black ?? '?'}`} onClose={onClose}>
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block space-y-1">
          <span className="text-xs text-muted">Notes</span>
          <textarea
            aria-label="Notes"
            rows={5}
            className={`${inputClass} w-full`}
            value={notes ?? ''}
            disabled={notes === null}
            placeholder={notes === null ? 'Loading…' : 'What this game taught me…'}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Tags (commas)</span>
          <input aria-label="Tags" className={`${inputClass} w-full`} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. endgame, blunder" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">I played</span>
          <select aria-label="I played" className={inputClass} value={myColor} onChange={(e) => setMyColor(e.target.value)}>
            <option value="">Neither (not my game)</option>
            <option value="white">White</option>
            <option value="black">Black</option>
          </select>
        </label>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className={buttonClass} onClick={() => void ws.openGameById(game.id)}>
            Open on the board
          </button>
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={primaryClass} disabled={notes === null}>
              Save
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Games in the library more than once: each kept once, the copy with the most notes and comments. */
function DuplicatesDialog({ onClose, onRemoved }: { onClose(): void; onRemoved(ids: string[]): void }) {
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.duplicates>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.duplicates().then(setFound).catch((e: Error) => setError(e.message));
  }, []);

  const label = (g: GameSummary) =>
    `${g.white ?? '?'} – ${g.black ?? '?'}, ${g.result === '1/2-1/2' ? '½-½' : g.result}${g.date ? `, ${g.date.replace(/\.\?\?/g, '')}` : ''}`;

  const remove = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const ids = found.groups.flatMap((g) => g.copies.map((c) => c.id));
      await api.deleteGames(ids);
      onRemoved(ids);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Duplicate games" onClose={onClose}>
      <div className="space-y-3 text-sm">
        {!found && !error && <p className="text-muted">Looking through the library…</p>}
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        {found && found.groups.length === 0 && <p>No game is in the library twice.</p>}
        {found && found.groups.length > 0 && (
          <>
            <p>
              {found.groups.length} game{found.groups.length === 1 ? ' is' : 's are'} in the library more than once ({found.extraCopies} extra cop
              {found.extraCopies === 1 ? 'y' : 'ies'}): same players, year, result and moves. Each keeps the copy with the most notes and comments.
            </p>
            <ul className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
              {found.groups.map((g) => (
                <li key={g.keep.id} className="flex justify-between gap-3">
                  <span className="truncate">{label(g.keep)}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {g.copies.length + 1} copies{g.keep.event ? ` · keeps “${g.keep.event}”` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>
            Close
          </button>
          {found && found.extraCopies > 0 && (
            <button type="button" className={dangerClass} disabled={busy} onClick={() => void remove()}>
              Move {found.extraCopies} extra cop{found.extraCopies === 1 ? 'y' : 'ies'} to the trash
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
