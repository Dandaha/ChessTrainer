import { type ReactNode, useEffect, useState } from 'react';
import { type GameSummary, type QueueSummary, type SavedPosition, SERVER_DOWN, api, useServerOnline } from '../api.ts';
import { QueueLine } from './TrainingScreen.tsx';
import { MiniBoard } from '../components/MiniBoard.tsx';
import { Empty, buttonClass, inputClass, primaryClass } from '../components/ui.tsx';
import { navigate } from '../router.ts';
import { useWorkspace } from '../workspace.tsx';
import { OUTCOME_CLASS, formatPgnDate, myOutcome } from '../gameText.ts';

/** Panels later phases put at the top of Home (the training queue). */
export const homePanels: (() => ReactNode)[] = [];

export function HomeScreen() {
  const ws = useWorkspace();
  const [text, setText] = useState('');
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [positions, setPositions] = useState<SavedPosition[] | null>(null);
  const online = useServerOnline();
  const [queue, setQueue] = useState<QueueSummary | null>(null);

  // Loaded when the screen opens, and again when the server comes back.
  useEffect(() => {
    if (!online) return;
    api
      .games({ sort: 'added', limit: 8 })
      .then((d) => setGames(d.games))
      .catch(() => {});
    api
      .savedPositions({ limit: 6 })
      .then((d) => setPositions(d.positions))
      .catch(() => {});
    api.trainingSummary().then(setQueue).catch(() => {});
  }, [online]);

  const open = async () => {
    const problem = await ws.openText(text);
    if (problem) ws.toast(problem, true);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      {homePanels.map((Panel, i) => (
        <Panel key={i} />
      ))}

      {/* A new library: where to begin. Gone once there are games or saved positions. */}
      {games?.length === 0 && positions?.length === 0 && (
        <section className="space-y-3 rounded-xl border border-accent/40 bg-surface p-5" aria-label="Get started">
          <div>
            <h2 className="text-lg font-semibold">Get started</h2>
            <p className="text-sm text-muted">Your chess workspace is empty. Four good first steps:</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              { title: 'Import your games', text: 'From Lichess or Chess.com by username, or a PGN file.', go: 'games', button: 'Games' },
              { title: 'Start a repertoire', text: 'Your openings for White and Black, trained move by move.', go: 'repertoire', button: 'Repertoire' },
              { title: 'Save positions to remember', text: 'Press S on the board, or set one up with New position.', go: 'positions', button: 'Positions' },
              { title: 'Read the concepts', text: '120 classic ideas, from forks to the Lucena position.', go: 'concepts', button: 'Concepts' },
            ].map((step, i) => (
              <li key={step.go} className="flex items-start gap-3 rounded-lg border border-line p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="block text-xs text-muted">{step.text}</span>
                </span>
                <button type="button" className={`${buttonClass} shrink-0 py-1 text-xs`} onClick={() => navigate(step.go)}>
                  {step.button}
                </button>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">Stockfish comes with the app: press E on the board to see its lines.</p>
        </section>
      )}

      {queue && queue.total > 0 && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold">Training today</h2>
            <QueueLine summary={queue} />
          </div>
          <button type="button" className={primaryClass} onClick={() => navigate('training')}>
            Start training
          </button>
        </section>
      )}

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

      {!online && <Empty>The library is unavailable. {SERVER_DOWN}</Empty>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Recently added games</h2>
            <a href="#/games" className="text-sm text-accent">
              All games
            </a>
          </div>
          {games && games.length === 0 && <Empty>No games yet. Import some on the Games screen.</Empty>}
          {games && games.length > 0 && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {games.map((g) => {
                const outcome = myOutcome(g);
                return (
                  <li key={g.id}>
                    <button type="button" onClick={() => void ws.openGameById(g.id)} className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate">
                          {g.white ?? '?'} – {g.black ?? '?'}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted">{g.result === '1/2-1/2' ? '½-½' : g.result}</span>
                      </span>
                      <span className="flex items-baseline gap-1.5 text-xs text-muted">
                        {outcome && <span className={`rounded px-1 font-medium ${OUTCOME_CLASS[outcome]}`}>{outcome}</span>}
                        <span className="truncate">{[g.eco && g.openingName ? `${g.eco} ${g.openingName}` : g.openingName, formatPgnDate(g.date)].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
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
