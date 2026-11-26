import { type Color, type Game, type RepertoireCheck, moveLabel, writePgn } from '@chess/chess-core';
import { useEffect, useRef, useState } from 'react';
import { type RepertoireSummary, api } from '../api.ts';
import { Modal } from '../Dialogs.tsx';
import { navigate } from '../router.ts';
import { primaryClass } from './ui.tsx';

const LAST_USED = 'chess-workspace:last-repertoire';

/** The board's Repertoire tab: what your repertoires say about this position, and where this game left them. */
export function RepertoireTab({
  fen,
  game,
  version,
  myColor,
  onGoToPly,
  onPlay,
}: {
  fen: string;
  game: Game;
  version: number;
  myColor?: Color;
  onGoToPly(ply: number): void;
  onPlay(san: string): void;
}) {
  const [here, setHere] = useState<Awaited<ReturnType<typeof api.repertoiresAt>> | null>(null);
  const [checks, setChecks] = useState<{ repertoire: RepertoireSummary; result: RepertoireCheck; message: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api.repertoiresAt(fen).then((r) => live && setHere(r)).catch((e: Error) => live && setError(e.message));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fen, version]);

  useEffect(() => {
    if (!game.root.children.length) {
      setChecks([]);
      return;
    }
    let live = true;
    api
      .checkGame(writePgn(game), myColor)
      .then((r) => live && setChecks(r))
      .catch(() => live && setChecks([]));
    return () => {
      live = false;
    };
  }, [game, version, myColor]);

  if (error) return <p className="p-3 text-sm text-muted">{error}</p>;

  return (
    <div className="space-y-3 p-3 text-sm">
      {checks && checks.length > 0 && (
        <div className="space-y-1">
          {checks.map((c) => (
            <p key={c.repertoire.id} className="rounded-md bg-accent-soft px-3 py-2">
              <span className="text-xs text-muted">{c.repertoire.name} ({c.repertoire.color}): </span>
              {c.message}{' '}
              {(c.result.kind === 'i-left' || c.result.kind === 'opponent-left') && (
                <button type="button" className="font-semibold text-accent" onClick={() => onGoToPly((c.result as { ply: number }).ply)}>
                  Go to that move
                </button>
              )}
            </p>
          ))}
        </div>
      )}
      {here && here.length === 0 && (
        <p className="text-muted">
          This position is not in a repertoire. Press <kbd>R</kbd> to add the line that leads here.
        </p>
      )}
      {here?.map(({ repertoire, moves, reached }) => (
        <div key={repertoire.id} className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              {repertoire.color === 'white' ? '♔' : '♚'} {repertoire.name}
            </span>
            <button type="button" className="text-xs text-accent" onClick={() => navigate(`repertoire/${repertoire.id}`)}>
              Open
            </button>
          </div>
          {!reached && <p className="text-xs text-muted">Not reached from the start of this repertoire.</p>}
          {moves.length === 0 ? (
            <p className="text-muted">Nothing prepared from here.</p>
          ) : (
            <ul className="space-y-0.5">
              {moves.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => onPlay(m.san)} className="font-semibold hover:text-accent">
                    {m.san}
                  </button>{' '}
                  <span className="text-xs text-muted">
                    {m.isMyMove ? 'your move' : 'expected'}
                    {m.isMain ? '' : ' · side line'}
                    {m.priority === 'nice' ? ' · nice to know' : ''}
                  </span>
                  {m.comment && <span className="block text-xs">{m.comment}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** R on the board: add the moves from the start of the game to here into a repertoire. */
export function AddToRepertoireDialog({
  rootFen,
  sans,
  startPly,
  onClose,
  onDone,
}: {
  rootFen: string;
  sans: string[];
  startPly: number;
  onClose(): void;
  onDone(message: string): void;
}) {
  const [list, setList] = useState<RepertoireSummary[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api
      .repertoires()
      .then((r) => {
        setList(r);
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_USED);
        } catch {
          // no storage: no memory of the last choice
        }
        setChosen(r.find((x) => x.id === last)?.id ?? r[0]?.id ?? '');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    form.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, [list]);

  const add = async () => {
    try {
      const r = await api.addLine(chosen, rootFen, sans);
      try {
        localStorage.setItem(LAST_USED, chosen);
      } catch {
        // fine
      }
      const name = list?.find((x) => x.id === chosen)?.name ?? '';
      onDone(r.added ? `Added ${r.added} move${r.added === 1 ? '' : 's'} to “${name}”.` : `“${name}” already has this line.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const line = sans.map((san, i) => moveLabel(startPly + i + 1, san)).join(' ');

  return (
    <Modal title="Add to repertoire" onClose={onClose}>
      {sans.length === 0 ? (
        <p className="text-sm text-muted">Go to a move first: R adds the line from the start of the game to the move on the board.</p>
      ) : (
        <form
          ref={form}
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <p className="text-sm">
            <span className="text-muted">Line: </span>
            {line}
          </p>
          {list && list.length === 0 && (
            <p className="text-sm text-muted">
              You have no repertoire yet.{' '}
              <button type="button" className="text-accent" onClick={() => navigate('repertoire')}>
                Create one
              </button>
              .
            </p>
          )}
          <div className="space-y-1">
            {list?.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input type="radio" name="repertoire" checked={chosen === r.id} onChange={() => setChosen(r.id)} />
                {r.color === 'white' ? '♔' : '♚'} {r.name} <span className="text-xs text-muted">({r.moves} moves)</span>
              </label>
            ))}
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" className={primaryClass} disabled={!chosen}>
              Add <kbd>Enter</kbd>
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
