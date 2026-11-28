import { type Color, type MoveNode, createGame, moveLabel, playMove } from '@chess/chess-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type CardDetail, type QueueSummary, type TrainingStats, api } from '../api.ts';
import { Board, type DrawShape } from '../Board.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Empty, PageHeader, buttonClass, primaryClass } from '../components/ui.tsx';
import { useRoute } from '../router.ts';
import { useWorkspace } from '../workspace.tsx';

type Grade = 1 | 2 | 3 | 4;
const GRADES: { grade: Grade; label: string }[] = [
  { grade: 1, label: 'Again' },
  { grade: 2, label: 'Hard' },
  { grade: 3, label: 'Good' },
  { grade: 4, label: 'Easy' },
];

/** The outcome of one card, before grading. */
interface Outcome {
  correct: boolean;
  suggested: Grade;
  message: string;
  detail?: string;
  /** The right move, drawn on the board. */
  arrow?: string;
  /** What "Show solution" reveals for a saved position: the answer line, and its first move to draw. */
  solution?: { text: string; uci?: string };
}

/** The first move of a written answer ("2. ... Qh4#" → "Qh4#"); move numbers and dots are not moves. */
function firstAnswerMove(answer: string): string | undefined {
  return answer
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^\d+\.+/, ''))
    .find((token) => token && !/^\.+$/.test(token));
}

/** A move in SAN from a position as UCI, or undefined when it is not legal there. */
function uciOf(fen: string, san: string | undefined): string | undefined {
  if (!san) return undefined;
  try {
    return playMove(createGame(fen).root, san).uci;
  } catch {
    return undefined;
  }
}

export function TrainingScreen() {
  const route = useRoute();
  const repertoireId = route.params.get('repertoire') ?? undefined;
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [session, setSession] = useState<CardDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.trainingSummary().then(setSummary).catch((e: Error) => setError(e.message));
    api.trainingStats().then(setStats).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  const start = async (type?: 'repertoire_move' | 'saved_position') => {
    try {
      setSession(await api.trainingQueue({ type, repertoireId }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (session) {
    return (
      <Session
        cards={session}
        onEnd={() => {
          setSession(null);
          refresh();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Training" />
      <div className="mx-auto w-full max-w-4xl space-y-8 p-6">
        {error && <Empty>{error}</Empty>}
        {summary && (
          <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">Today</h2>
            <QueueLine summary={summary} />
            {summary.total === 0 ? (
              <p className="text-sm text-muted">
                Nothing to train yet. Your main-line moves become cards as soon as a repertoire has them, and saved
                positions join when you tick “In training”.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryClass} onClick={() => void start()}>
                  {repertoireId ? 'Train this repertoire' : 'Train everything due'}
                </button>
                {!repertoireId && (
                  <>
                    <button type="button" className={buttonClass} onClick={() => void start('repertoire_move')}>
                      Repertoire only
                    </button>
                    <button type="button" className={buttonClass} onClick={() => void start('saved_position')}>
                      Positions only
                    </button>
                  </>
                )}
              </div>
            )}
          </section>
        )}
        {stats && <Stats stats={stats} />}
      </div>
    </div>
  );
}

export function QueueLine({ summary }: { summary: QueueSummary }) {
  const parts = [
    `${summary.repertoireDue} repertoire card${summary.repertoireDue === 1 ? '' : 's'}`,
    `${summary.positionsDue} position${summary.positionsDue === 1 ? '' : 's'} due today`,
  ];
  return (
    <p>
      {parts.join(' and ')}
      {summary.newToday > 0 && <span className="text-muted">, plus {summary.newToday} new</span>}.
    </p>
  );
}

function Stats({ stats }: { stats: TrainingStats }) {
  const max = Math.max(1, ...stats.days.map((d) => d.reviews));
  const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Last two weeks</h2>
      <div className="flex h-24 items-end gap-1" aria-label="Reviews per day">
        {stats.days.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.reviews} reviews, ${d.correct} right`}>
            <div className="w-full rounded-t-sm bg-accent" style={{ height: `${(d.reviews / max) * 80}px`, opacity: d.reviews ? 1 : 0.15 }} />
            <span className="text-[10px] text-muted">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1">Accuracy</th>
            <th className="text-right">Cards</th>
            <th className="text-right">Reviews</th>
            <th className="text-right">Right</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {stats.byRepertoire.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5">
                {r.color === 'white' ? '♔' : '♚'} {r.name}
              </td>
              <td className="text-right tabular-nums">{r.cards}</td>
              <td className="text-right tabular-nums">{r.reviews}</td>
              <td className="text-right tabular-nums">{pct(r.accuracy)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5">Saved positions</td>
            <td className="text-right tabular-nums">{stats.positions.cards}</td>
            <td className="text-right tabular-nums">{stats.positions.reviews}</td>
            <td className="text-right tabular-nums">{pct(stats.positions.accuracy)}</td>
          </tr>
        </tbody>
      </table>
      {stats.weakest.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Weakest lines</h3>
          <ul className="space-y-0.5 text-sm">
            {stats.weakest.map((w) => (
              <li key={w.cardId} className="flex justify-between gap-3">
                <span className="truncate">{w.label}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {pct(w.accuracy)} of {w.reviews}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A board node for a position, to show on the training board. */
function at(fen: string, uci = '', ply = 0): MoveNode {
  return { ...createGame(fen).root, id: `${fen}|${uci}`, uci, ply };
}

function Session({ cards: initial, onEnd }: { cards: CardDetail[]; onEnd(): void }) {
  const ws = useWorkspace();
  // The session's cards; one graded Again joins the end to be asked again, as in Anki and Chessable.
  const [cards, setCards] = useState(initial);
  const [index, setIndex] = useState(0);
  const [node, setNode] = useState<MoveNode | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [right, setRight] = useState(0);
  const [typed, setTyped] = useState('');
  // A card answered wrong stays wrong for scheduling, even when "Try again" then finds the move.
  const [failed, setFailed] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  const timers = useRef<number[]>([]);
  const card = cards[index];

  // Show the card: for a repertoire card, play the line up to my move, a move at a time.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setOutcome(null);
    setFailed(false);
    setShowSolution(false);
    if (!card) return;
    if (card.kind === 'saved_position') {
      setNode(at(card.saved.fen));
      return;
    }
    let current = createGame(card.startFen).root;
    setNode(current);
    const fast = card.line.length > 10;
    card.line.forEach((san, i) => {
      timers.current.push(
        window.setTimeout(() => {
          current = playMove(current, san);
          setNode(current);
        }, (i + 1) * (fast ? 120 : 280)),
      );
    });
    return () => timers.current.forEach(clearTimeout);
  }, [card, index]);

  const color: Color = card ? (card.kind === 'repertoire_move' ? card.repertoire.color : card.saved.sideToSolve) : 'white';
  const ready = card && node && (card.kind === 'saved_position' || node.fen === card.fen);
  // A repertoire move seen for the first time is learned before it is asked: the board shows it
  // (arrow and comment) and I play it once, as in Chessable's learn mode. Reviews then ask without help.
  const learning = card?.kind === 'repertoire_move' && card.card.state === 0;

  const grade = useCallback(
    async (g: Grade) => {
      if (!card || !outcome) return;
      const correct = outcome.correct && !failed;
      await api.review(card.card.id, g, correct).catch((e: Error) => ws.toast(e.message, true));
      if (correct) setRight((r) => r + 1);
      const again = g === 1 && cards.filter((c) => c.card.id === card.card.id).length < 3;
      // Reviewed now, so no longer new: it comes back to be answered, not shown (learn mode is once).
      if (again) setCards((list) => [...list, { ...card, card: { ...card.card, state: card.card.state === 0 ? 1 : card.card.state } }]);
      if (index + 1 >= cards.length + (again ? 1 : 0)) onEnd();
      else setIndex(index + 1);
    },
    [card, outcome, failed, index, cards, onEnd, ws],
  );

  /** Back to the position for another go; the card is already counted as missed. */
  const tryAgain = useCallback(() => {
    if (!card) return;
    setFailed(true);
    setShowSolution(false);
    setOutcome(null);
    setNode(at(card.kind === 'saved_position' ? card.saved.fen : card.fen));
  }, [card]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEnd();
      if (!outcome) return;
      if (!outcome.correct && event.key.toLowerCase() === 't') tryAgain();
      if (!outcome.correct && event.key.toLowerCase() === 's' && outcome.solution) setShowSolution(true);
      const g = Number(event.key);
      if (g >= 1 && g <= 4) void grade(g as Grade);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void grade(outcome.suggested);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [outcome, grade, onEnd, tryAgain]);

  const onMove = async (from: string, to: string, promotion?: string) => {
    // While Stockfish checks the answer, the board waits: a second move would land on the card.
    if (!card || !node || outcome || !ready || checking) return;
    let played: MoveNode;
    try {
      played = playMove(node, promotion ? { from, to, promotion } : { from, to });
    } catch {
      setNode({ ...node });
      return;
    }
    setNode(played);
    if (card.kind === 'repertoire_move') {
      if (played.uci === card.answer.uci) {
        setOutcome({
          correct: true,
          suggested: failed ? 1 : 3,
          message: failed
            ? `Right this time: ${card.answer.san}.`
            : learning
              ? `Learned: ${card.answer.san}. It comes back for review soon.`
              : `Right: ${card.answer.san}.`,
          detail: card.answer.comment ?? undefined,
        });
      } else if (card.alternatives.some((a) => a.uci === played.uci)) {
        setOutcome({
          correct: true,
          suggested: 2,
          message: `${played.san} is in your repertoire too, but your main move is ${card.answer.san}.`,
          detail: card.answer.comment ?? undefined,
          arrow: card.answer.uci,
        });
      } else {
        // A move that reaches a position my repertoire reaches through my own moves is a transposition.
        setChecking(true);
        const reaches = await api
          .repertoireReaches(card.repertoire.id, played.fen)
          .then((r) => r.reaches)
          .catch(() => false);
        setChecking(false);
        setOutcome(
          reaches
            ? {
                correct: true,
                suggested: failed ? 1 : 2,
                message: `${played.san} transposes into your repertoire; here your move is ${card.answer.san}.`,
                detail: card.answer.comment ?? undefined,
                arrow: card.answer.uci,
              }
            : {
                correct: false,
                suggested: 1,
                message: `Your repertoire plays ${card.answer.san} here, not ${played.san}.`,
                detail: card.answer.comment ?? undefined,
                arrow: card.answer.uci,
              },
        );
      }
      return;
    }
    setChecking(true);
    try {
      const result = await api.checkMove(card.saved.fen, played.uci, card.saved.answer);
      // Right when it is the written answer, or when Stockfish finds it as good: a second mate, or
      // another move that wins as much, counts, as on Lichess and ChessTempo.
      const engineGood = result.engine?.good === true;
      const correct = result.answerMatch === true || engineGood;
      const answer = card.saved.answer?.trim();
      const best = result.engine?.best;
      setOutcome({
        correct,
        suggested: correct && !failed ? 3 : 1,
        solution: answer
          ? { text: `Answer: ${answer}`, uci: uciOf(card.saved.fen, firstAnswerMove(answer)) }
          : best
            ? { text: `Stockfish plays ${best}.`, uci: uciOf(card.saved.fen, best) }
            : undefined,
        message: correct && failed ? `Right this time: ${result.san}.` :
          result.answerMatch === true
            ? `Right: ${result.san} is your answer.`
            : result.answerMatch === false
              ? engineGood
                ? `${result.san} works too (your answer was ${card.saved.answer}).`
                : `Your answer was ${card.saved.answer}; you played ${result.san}.`
              : `You played ${result.san}.`,
        detail: engineVerdict(result, card.saved.fen),
      });
    } catch (e) {
      ws.toast((e as Error).message, true);
    } finally {
      setChecking(false);
    }
  };

  if (!card || !node) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="mb-4 text-lg">Nothing due right now.</p>
        <button type="button" className={primaryClass} onClick={onEnd}>
          Back
        </button>
      </div>
    );
  }

  const shown =
    outcome?.arrow ??
    (showSolution ? outcome?.solution?.uci : undefined) ??
    (learning && ready && !outcome && card.kind === 'repertoire_move' ? card.answer.uci : undefined);
  const arrows: DrawShape[] = shown
    ? [{ orig: shown.slice(0, 2) as DrawShape['orig'], dest: shown.slice(2, 4) as DrawShape['orig'], brush: 'green' }]
    : [];

  return (
    <div className="flex h-full flex-col" data-overlay>
      <div className="flex items-center gap-4 border-b border-line bg-surface px-5 py-2 text-sm">
        <span className="font-semibold">Training</span>
        <span className="tabular-nums text-muted">
          {index + 1} / {cards.length} · {right} right
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${(index / cards.length) * 100}%` }} />
        </div>
        <button type="button" className="text-muted hover:text-text" onClick={onEnd}>
          Stop <kbd>Esc</kbd>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 overflow-auto p-6 lg:flex-row">
        <Board node={node} orientation={color} autoShapes={arrows} viewOnly={!ready || !!outcome} onMove={(f, t, p) => void onMove(f, t, p)} onShapes={() => {}} />
        <div className="w-full max-w-sm space-y-4">
          {card.kind === 'repertoire_move' ? (
            <>
              <p className="text-sm text-muted">
                {card.repertoire.color === 'white' ? '♔' : '♚'} {card.repertoire.name}
                {card.card.state === 0 && ' · new'}
              </p>
              <p className="text-sm">{card.line.map((san, i) => moveLabel(i + 1, san)).join(' ') || 'Starting position'}</p>
              <h2 className="text-xl font-semibold">
                {!ready ? 'Watch the line…' : learning && !outcome ? `New move: play ${card.answer.san}` : 'Your move'}
              </h2>
              {learning && ready && !outcome && card.answer.comment && <p className="text-sm">{card.answer.comment}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Saved position{card.card.state === 0 && ' · new'}</p>
              <h2 className="text-xl font-semibold">{card.saved.title}</h2>
              <p>{card.saved.sideToSolve === 'white' ? 'White' : 'Black'} to play. Find the move.</p>
            </>
          )}
          {ready && !outcome && (
            <input
              aria-label="Type your move"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !typed.trim()) return;
                e.stopPropagation();
                const text = typed.trim();
                const tries = [text, text[0]!.toUpperCase() + text.slice(1)];
                for (const t of tries) {
                  try {
                    const m = playMove(node, t);
                    setTyped('');
                    void onMove(m.uci.slice(0, 2), m.uci.slice(2, 4), m.uci[4]);
                    return;
                  } catch {
                    // try the next spelling
                  }
                }
                ws.toast(`${text} is not a legal move here.`, true);
              }}
              placeholder="Or type it, e.g. Nf3"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          )}
          {checking && <p className="text-sm text-muted">Checking with Stockfish…</p>}
          {outcome && (
            <div className={`space-y-2 rounded-xl border p-4 ${outcome.correct ? 'border-accent' : 'border-danger'}`}>
              <p className={`font-semibold ${outcome.correct ? 'text-accent' : 'text-danger'}`}>{outcome.message}</p>
              {outcome.detail && <p className="text-sm">{outcome.detail}</p>}
              {showSolution && outcome.solution && <p className="text-sm font-medium">{outcome.solution.text}</p>}
              {!outcome.correct && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} onClick={tryAgain}>
                    Try again <kbd>T</kbd>
                  </button>
                  {outcome.solution && !showSolution && (
                    <button type="button" className={buttonClass} onClick={() => setShowSolution(true)}>
                      Show solution <kbd>S</kbd>
                    </button>
                  )}
                </div>
              )}
              {card.kind === 'saved_position' && (card.saved.keyIdea || card.saved.notesMd) && (
                <div className="space-y-1 border-t border-line pt-2 text-sm">
                  {card.saved.keyIdea && <p>{card.saved.keyIdea}</p>}
                  {card.saved.notesMd && <Markdown text={card.saved.notesMd} fen={card.saved.fen} />}
                </div>
              )}
              <div className="flex flex-wrap gap-1 pt-1">
                {GRADES.map(({ grade: g, label }) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => void grade(g)}
                    className={g === outcome.suggested ? primaryClass : buttonClass}
                    title={`${label} (${g})`}
                  >
                    {label} <span className="text-xs opacity-70">{g}</span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted">
                <kbd>Enter</kbd> accepts the highlighted grade.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Stockfish's view of the move, in words. Scores come from White's side; they are turned to the
 * mover's side, so "gives away the win" is said only when a win really turns into something less.
 */
function engineVerdict(result: Awaited<ReturnType<typeof api.checkMove>>, fen: string): string {
  const engine = result.engine;
  if (!engine) return result.engineError ? `No engine check: ${result.engineError}` : '';
  if (engine.good) return `Stockfish agrees${engine.best && engine.best !== result.san ? ` (its first choice is ${engine.best})` : ''}.`;
  const side = fen.split(' ')[1] === 'b' ? -1 : 1;
  const best = engine.bestScore * side;
  const played = engine.playedScore * side;
  const MATE = 50;
  if (best >= MATE && played >= 3) return `Stockfish prefers ${engine.best}, which mates; ${result.san} still wins, more slowly.`;
  if (best >= 2 && played < 1) return `Stockfish prefers ${engine.best}; ${result.san} gives away the win.`;
  if (best > -1 && played <= -2) return `Stockfish prefers ${engine.best}; ${result.san} loses.`;
  return `Stockfish prefers ${engine.best}; ${result.san} costs ${Math.min(engine.loss, 9.9).toFixed(1)} pawns.`;
}
