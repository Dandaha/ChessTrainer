import { useEffect, useState } from 'react';
import { type ConceptSummary, type GameSummary, type MoveStat, type SavedPosition, api } from '../api.ts';
import { ConceptPicker, LinkedConcepts } from './ConceptPicker.tsx';
import { navigate } from '../router.ts';

/** Fetches whenever the position changes, a moment after the last change. */
function useAt<T>(fen: string, load: (fen: string) => Promise<T>, refresh = 0): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      load(fen)
        .then((data) => live && setState({ data, error: null }))
        .catch((e: Error) => live && setState({ data: null, error: e.message }));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fen, refresh]);
  return state;
}

function ResultBar({ m }: { m: MoveStat }) {
  const pct = (n: number) => `${(n / m.games) * 100}%`;
  return (
    <div className="flex h-2 w-24 overflow-hidden rounded-sm border border-line" title={`+${m.whiteWins} =${m.draws} −${m.blackWins}`}>
      <div style={{ width: pct(m.whiteWins) }} className="bg-[#f4f2ee]" />
      <div style={{ width: pct(m.draws) }} className="bg-[#a3a09a]" />
      <div style={{ width: pct(m.blackWins) }} className="bg-[#2b2a27]" />
    </div>
  );
}

/** Games in the library that reached the position on the board, and what was played from it. */
export function GamesHere({
  fen,
  onPlay,
  onOpen,
}: {
  fen: string;
  onPlay(san: string): void;
  onOpen(id: string, ply: number): void;
}) {
  const { data, error } = useAt(fen, (f) => api.gamesAt(f));
  if (error) return <p className="p-3 text-sm text-muted">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted">Searching…</p>;
  if (!data.total) return <p className="p-3 text-sm text-muted">No game in your library reached this position.</p>;
  return (
    <div className="space-y-3 p-3 text-sm">
      <p className="text-muted">
        Reached in {data.total} game{data.total === 1 ? '' : 's'}.
      </p>
      {data.moves.length > 0 && (
        <table className="w-full">
          <tbody>
            {data.moves.map((m) => (
              <tr key={m.san} className="cursor-pointer hover:bg-surface-2" onClick={() => onPlay(m.san)}>
                <td className="py-0.5 pr-2 font-semibold">{m.san}</td>
                <td className="pr-2 text-right tabular-nums text-muted">{m.games}</td>
                <td>
                  <ResultBar m={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ul className="divide-y divide-line">
        {data.games.map((g: GameSummary & { ply: number }) => (
          <li key={g.id}>
            <button type="button" onClick={() => onOpen(g.id, g.ply)} className="w-full py-1.5 text-left hover:text-accent">
              {g.white ?? '?'} – {g.black ?? '?'} <span className="text-muted">{g.result}</span>
              <span className="block text-xs text-muted">
                {[g.event, g.date?.slice(0, 4)].filter(Boolean).join(', ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Saves of the position on the board. */
export function SavedHere({ fen, refresh, onSave, gameId }: { fen: string; refresh: number; onSave(): void; gameId?: string }) {
  const { data, error } = useAt(fen, (f) => api.savedPositions({ fen: f, limit: 20 }), refresh);
  const [conceptRefresh, setConceptRefresh] = useState(0);
  const concepts = useAt(fen, (f) => api.conceptsAt(f), refresh + conceptRefresh);
  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="space-y-1">
        <span className="text-xs text-muted">Concepts for this position</span>
        <ConceptPicker
          linked={concepts.data ?? []}
          onAdd={async (c: ConceptSummary) => {
            await api.linkConcept(c.id, 'position', { fen });
            setConceptRefresh((n) => n + 1);
          }}
        />
      </div>
      {gameId && (
        <div className="space-y-1">
          <span className="text-xs text-muted">Concepts for this game</span>
          <LinkedConcepts targetType="game" targetId={gameId} />
        </div>
      )}
      {error && <p className="text-muted">{error}</p>}
      {data && data.total === 0 && <p className="text-muted">Not saved yet.</p>}
      <ul className="divide-y divide-line">
        {data?.positions.map((p: SavedPosition) => (
          <li key={p.id}>
            <button type="button" onClick={() => navigate(`positions?open=${p.id}`)} className="w-full py-1.5 text-left hover:text-accent">
              {p.title}
              <span className="block text-xs text-muted">
                {[p.category, ...p.tags.map((t) => `#${t}`), p.inTraining ? 'in training' : ''].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onSave} className="rounded-md border border-line px-2 py-1 hover:bg-surface-2">
        Save this position <kbd>S</kbd>
      </button>
    </div>
  );
}
