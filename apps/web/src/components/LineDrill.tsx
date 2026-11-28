import {
  type Color,
  type MoveNode,
  type RepEdge,
  createGame,
  edgesByFrom,
  lineLabel,
  pickReply,
  playMove,
  positionKey,
} from '@chess/chess-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Board, type DrawShape } from '../Board.tsx';
import { buttonClass, primaryClass } from './ui.tsx';

/**
 * A repertoire line from the first move: I play my moves, the opponent answers from the repertoire
 * (main and must-know replies more often), until the preparation ends. Practice only: the review
 * schedule is left as it is. `guide` is a line to follow first (from the repertoire screen's
 * selected move); after it, the replies are picked at random.
 */
export function LineDrill({ repertoireId, guide = [], onEnd }: { repertoireId: string; guide?: string[]; onEnd(): void }) {
  const [repertoire, setRepertoire] = useState<{ name: string; color: Color; edges: RepEdge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<MoveNode[]>([]);
  const [hint, setHint] = useState<string[]>(guide);
  const [feedback, setFeedback] = useState<{ text: string; good: boolean; arrow?: string } | null>(null);
  const [missedHere, setMissedHere] = useState(false);
  const [tally, setTally] = useState({ mine: 0, right: 0 });
  const [done, setDone] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api
      .repertoire(repertoireId)
      .then((r) => setRepertoire({ name: r.repertoire.name, color: r.repertoire.color, edges: r.edges }))
      .catch((e: Error) => setError(e.message));
  }, [repertoireId]);

  const byFrom = useMemo(() => edgesByFrom(repertoire?.edges ?? []), [repertoire]);
  const root = useMemo(() => createGame().root, [round]);
  const node = path.at(-1) ?? root;
  const color = repertoire?.color ?? 'white';
  const myTurn = (fen: string) => (fen.split(' ')[1] === 'w') === (color === 'white');
  const edgesAt = useCallback((fen: string) => byFrom.get(positionKey(fen)) ?? [], [byFrom]);
  /** The guide's move at this point, while the drill is still on the guide. */
  const guided = (at: number) => hint[at];

  // The opponent's turn: a reply after a short pause; no reply prepared, or no move of mine, ends it.
  useEffect(() => {
    if (!repertoire || done) return;
    const here = edgesAt(node.fen);
    if (myTurn(node.fen)) {
      if (!here.some((e) => e.isMyMove)) setDone(path.length ? 'End of the line: you have no move prepared here.' : 'This repertoire has no first move yet.');
      return;
    }
    const replies = here.filter((e) => !e.isMyMove);
    if (!replies.length) {
      setDone('End of the line: no reply is prepared here.');
      return;
    }
    const wanted = guided(path.length);
    const reply = replies.find((e) => e.san === wanted) ?? pickReply(replies)!;
    if (reply.san !== wanted) setHint([]);
    timer.current = window.setTimeout(() => setPath((p) => [...p, playMove(node, reply.san)]), 500);
    return () => window.clearTimeout(timer.current);
    // Runs once for each new position.
  }, [repertoire, node, done]);

  const onMove = (from: string, to: string, promotion?: string) => {
    if (!repertoire || done || !myTurn(node.fen)) return;
    let played: MoveNode;
    try {
      played = playMove(node, promotion ? { from, to, promotion } : { from, to });
    } catch {
      setPath((p) => [...p]);
      return;
    }
    const mine = edgesAt(node.fen).filter((e) => e.isMyMove);
    const expected = mine.find((e) => e.san === guided(path.length)) ?? mine.find((e) => e.isMain) ?? mine[0]!;
    const prepared = mine.find((e) => e.uci === played.uci);
    if (!prepared) {
      if (!missedHere) setTally((t) => ({ mine: t.mine + 1, right: t.right }));
      setMissedHere(true);
      setFeedback({ text: `Your repertoire plays ${expected.san} here, not ${played.san}.`, good: false, arrow: expected.uci });
      setPath((p) => [...p]); // the board goes back to the position
      return;
    }
    if (!missedHere) setTally((t) => ({ mine: t.mine + 1, right: t.right + 1 }));
    setMissedHere(false);
    if (prepared.uci !== expected.uci) {
      setHint([]);
      setFeedback({ text: `${played.san} is prepared too (the main move is ${expected.san}).`, good: true });
    } else setFeedback(null);
    setPath((p) => [...p, played]);
  };

  const restart = (follow: string[]) => {
    window.clearTimeout(timer.current);
    setHint(follow);
    setPath([]);
    setFeedback(null);
    setMissedHere(false);
    setTally({ mine: 0, right: 0 });
    setDone(null);
    setRound((r) => r + 1);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEnd();
      if (done && event.key.toLowerCase() === 'n') restart([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const arrows: DrawShape[] = feedback?.arrow
    ? [{ orig: feedback.arrow.slice(0, 2) as DrawShape['orig'], dest: feedback.arrow.slice(2, 4) as DrawShape['orig'], brush: 'green' }]
    : [];

  return (
    <div className="flex h-full flex-col" data-overlay>
      <div className="flex items-center gap-4 border-b border-line bg-surface px-5 py-2 text-sm">
        <span className="font-semibold">Line drill</span>
        <span className="text-muted">{repertoire?.name}</span>
        <span className="tabular-nums text-muted">
          {tally.right} / {tally.mine} right
        </span>
        <span className="flex-1" />
        <button type="button" className="text-muted hover:text-text" onClick={onEnd}>
          Stop <kbd>Esc</kbd>
        </button>
      </div>
      {error ? (
        <p className="p-6 text-danger">{error}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-auto p-6 lg:flex-row">
          <Board
            node={node}
            orientation={color}
            autoShapes={arrows}
            viewOnly={!repertoire || !!done || !myTurn(node.fen)}
            onMove={onMove}
            onShapes={() => {}}
          />
          <div className="w-full max-w-sm space-y-4">
            <p className="text-sm text-muted">
              Practice: the whole line from the first move. Your review schedule is not changed.
            </p>
            <p className="min-h-10 text-sm">{lineLabel(path) || 'Starting position'}</p>
            {!done && <h2 className="text-xl font-semibold">{repertoire && myTurn(node.fen) ? 'Your move' : 'The opponent…'}</h2>}
            {feedback && <p className={`text-sm font-medium ${feedback.good ? 'text-accent' : 'text-danger'}`}>{feedback.text}</p>}
            {done && (
              <div className="space-y-3 rounded-xl border border-accent p-4">
                <p className="font-semibold">{done}</p>
                <p className="text-sm">
                  {tally.mine ? `${tally.right} of your ${tally.mine} moves right the first time.` : 'No move of yours in this line.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={primaryClass} onClick={() => restart([])}>
                    Another line <kbd>N</kbd>
                  </button>
                  <button type="button" className={buttonClass} onClick={() => restart(path.map((n) => n.san))}>
                    This line again
                  </button>
                  <button type="button" className={buttonClass} onClick={onEnd}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
