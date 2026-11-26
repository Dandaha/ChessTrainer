import { type ReactNode, useEffect, useState } from 'react';
import { type GameSummary, type SavedPosition, api } from '../api.ts';
import { MiniBoard } from '../components/MiniBoard.tsx';
import { Empty, buttonClass, inputClass, primaryClass } from '../components/ui.tsx';
import { navigate } from '../router.ts';
import { useWorkspace } from '../workspace.tsx';

/** Panels later phases put at the top of Home (the training queue). */
export const homePanels: (() => ReactNode)[] = [];

export function HomeScreen() {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [positions, setPositions] = useState<SavedPosition[] | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api
      .games({ sort: 'added', limit: 8 })
      .then((d) => setGames(d.games))
      .catch(() => setOffline(true));
    api
      .savedPositions({ limit: 6 })
      .then((d) => setPositions(d.positions))
      .catch(() => setOffline(true));
  }, []);

  const open = () => {
    const problem = ws.openText(text);
    if (problem) ws.toast(problem, true);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {homePanels.map((Panel, i) => (
        <Panel key={i} />
      ))}

      <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
        <h2 className="text-sm font-semibold">Open a PGN or FEN</h2>
        <textarea
          aria-label="Paste PGN or FEN"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) open();
          }}
          rows={3}
          spellCheck={false}
          placeholder="Paste here, or press Ctrl+V anywhere outside a text field."
          className={`${inputClass} w-full font-mono`}
        />
        <div className="flex gap-2">
          <button type="button" className={primaryClass} disabled={!text.trim()} onClick={open}>
            Open on board
          </button>
          <button type="button" className={buttonClass} onClick={() => navigate('board')}>
            Go to the board
          </button>
        </div>
      </section>

      {offline && <Empty>The local server is not running, so the library is unavailable. Start it with pnpm dev.</Empty>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recently added games</h2>
            <a href="#/games" className="text-sm text-accent">
              All games
            </a>
          </div>
          {games && games.length === 0 && <Empty>No games yet. Import some on the Games screen.</Empty>}
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {games?.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => void ws.openGameById(g.id)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <span>
                    {g.white ?? '?'} – {g.black ?? '?'}
                  </span>
                  <span className="text-muted">
                    {g.result} {g.date?.slice(0, 4)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recently saved positions</h2>
            <a href="#/positions" className="text-sm text-accent">
              All positions
            </a>
          </div>
          {positions && positions.length === 0 && <Empty>Press S on the board to save a position.</Empty>}
          <div className="grid grid-cols-3 gap-2">
            {positions?.map((p) => (
              <button key={p.id} type="button" onClick={() => navigate(`positions?open=${p.id}`)} className="overflow-hidden rounded-lg border border-line bg-surface text-left">
                <MiniBoard fen={p.fen} flipped={p.sideToSolve === 'black'} />
                <div className="truncate px-2 py-1 text-xs">{p.title}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
