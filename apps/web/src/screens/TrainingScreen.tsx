import { type Color, type MoveNode, answerLine, createGame, describeGameEnd, displayComment, gameEnd, lineLabel, moveSpellings, playMove } from '@chess/chess-core';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dialogOpen } from '../Dialogs.tsx';
import { type CardDetail, type QueueSummary, type SavedPosition, type TrainingStats, api, useServerOnline } from '../api.ts';
import { Board, type DrawShape } from '../Board.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Empty, PageHeader, buttonClass, primaryClass } from '../components/ui.tsx';
import { navigate, useRoute } from '../router.ts';
import { LineDrill } from '../components/LineDrill.tsx';
import { useWorkspace } from '../workspace.tsx';

type Grade = 1 | 2 | 3 | 4;
const GRADES: { grade: Grade; label: string }[] = [
  { grade: 1, label: 'Again' },
  { grade: 2, label: 'Hard' },
  { grade: 3, label: 'Good' },
  { grade: 4, label: 'Easy' },
];

/** A saved position solved as practice (a set, on demand): no review card is behind it. */
interface PracticeCard {
  kind: 'saved_position';
  card: null;
  saved: SavedPosition;
}

type SessionCard = CardDetail | PracticeCard;

/** How one position of a practice session went: right the first time, or not. */
interface SolveResult {
  saved: SavedPosition;
  right: boolean;
}

/** The outcome of one card, before grading. */
interface Outcome {
  correct: boolean;
  /**
   * Nothing could judge the move: no answer is saved and Stockfish gave no verdict. In practice the
   * person then says whether they had it.
   */
  unjudged?: boolean;
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
  const drill = route.params.get('drill');
  const solveSet = route.params.get('set');
  const [summary, setSummary] = useState<QueueSummary | null>(null);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [session, setSession] = useState<CardDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // With a repertoire chosen, the counts are that repertoire's, as its session will show them.
  const [scopeName, setScopeName] = useState<string | null>(null);
  const refresh = useCallback(() => {
    setError(null);
    api.trainingSummary(repertoireId).then(setSummary).catch((e: Error) => setError(e.message));
    api.trainingStats().then(setStats).catch(() => {});
    if (repertoireId)
      api
        .repertoires()
        .then((list) => {
          const r = list.find((x) => x.id === repertoireId);
          setScopeName(r ? `${r.color === 'white' ? '♔' : '♚'} ${r.name}` : null);
        })
        .catch(() => {});
    else setScopeName(null);
  }, [repertoireId]);
  useEffect(refresh, [refresh]);
  // Lost and found again: the counts come back by themselves. While it is lost the banner at the
  // bottom says so; the page does not say it a second time.
  const online = useServerOnline();
  useEffect(() => {
    if (online && error) refresh();
  }, [online]);

  const start = async (type?: 'repertoire_move' | 'saved_position') => {
    try {
      setSession(await api.trainingQueue({ type, repertoireId }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (drill) {
    return (
      <LineDrill
        key={`${drill}|${route.params.get('line') ?? ''}`}
        repertoireId={drill}
        guide={route.params.get('line')?.split(',').filter(Boolean) ?? []}
        // Back where the drill was started from.
        onEnd={() => navigate(route.params.get('from') === 'training' ? `training?repertoire=${drill}` : `repertoire/${drill}`)}
      />
    );
  }

  if (solveSet) return <SetSolve key={solveSet} setId={solveSet} />;

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
        {error && online && (
          <Empty>
            {error}{' '}
            <button type="button" className="font-medium text-accent hover:underline" onClick={refresh}>
              Try again
            </button>
          </Empty>
        )}
        {summary && (
          <section className="space-y-3 rounded-xl border border-line bg-surface p-5">
            <h2 className="text-lg font-semibold">Today{scopeName ? ` in ${scopeName}` : ''}</h2>
            <QueueLine summary={summary} />
            {summary.total === 0 ? (
              <p className="text-sm text-muted">
                Nothing to train yet. Your main-line moves become cards as soon as a repertoire has them, and saved
                positions join when you tick “In training”.
              </p>
            ) : summary.repertoireDue + summary.positionsDue + summary.newToday === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">All done for today: each card comes back on the day it is due.{repertoireId ? ' Drilling lines is practice, any time.' : ''}</p>
                {repertoireId && (
                  <button type="button" className={buttonClass} onClick={() => navigate(`training?drill=${repertoireId}&from=training`)} title="Whole lines from the first move, as practice">
                    Drill lines
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryClass} onClick={() => void start()}>
                  {repertoireId ? 'Train this repertoire' : 'Start training'}
                </button>
                {repertoireId && (
                  <button type="button" className={buttonClass} onClick={() => navigate(`training?drill=${repertoireId}&from=training`)} title="Whole lines from the first move, as practice">
                    Drill lines
                  </button>
                )}
                {!repertoireId && (
                  <>
                    <button type="button" className={buttonClass} onClick={() => void start('repertoire_move')} disabled={summary.repertoireDue + summary.newToday === 0}>
                      Repertoire only
                    </button>
                    <button type="button" className={buttonClass} onClick={() => void start('saved_position')} disabled={summary.positionsDue + summary.newToday === 0}>
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

/** "12 to review (8 repertoire, 4 positions) · 20 new to learn." */
export function QueueLine({ summary }: { summary: QueueSummary }) {
  const due = summary.repertoireDue + summary.positionsDue;
  const which =
    summary.repertoireDue && summary.positionsDue
      ? ` (${summary.repertoireDue} repertoire, ${summary.positionsDue} position${summary.positionsDue === 1 ? '' : 's'})`
      : '';
  return (
    <p>
      {due ? `${due} to review${which}` : 'Nothing to review'}
      {summary.newToday > 0 && <span className="text-muted"> · {summary.newToday} new to learn</span>}.
    </p>
  );
}

function Stats({ stats }: { stats: TrainingStats }) {
  const max = Math.max(1, ...stats.days.map((d) => d.reviews));
  const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
  return (
    <section className="space-y-4">
      <h2 className="font-semibold">Last two weeks</h2>
      {stats.days.every((d) => !d.reviews) && <p className="text-sm text-muted">No reviews yet: your first session shows here.</p>}
      <div className="flex h-24 items-end gap-1" aria-label="Reviews per day">
        {stats.days.map((d) => (
          <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.reviews} reviews, ${d.correct} right`}>
            <div className="w-full rounded-t-sm bg-accent" style={{ height: `${Math.max(2, (d.reviews / max) * 80)}px`, opacity: d.reviews ? 1 : 0.25 }} />
            <span className="text-[10px] text-muted">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-1">Trained</th>
            <th className="w-20 pl-4 text-right">Cards</th>
            <th className="w-20 pl-4 text-right">Reviews</th>
            <th className="w-20 pl-4 text-right">Right</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {stats.byRepertoire.map((r) => (
            <tr key={r.id}>
              <td className="py-1.5 [overflow-wrap:anywhere]">
                {r.color === 'white' ? '♔' : '♚'} {r.name}
              </td>
              <td className="pl-4 text-right tabular-nums">{r.cards}</td>
              <td className="pl-4 text-right tabular-nums">{r.reviews}</td>
              <td className="pl-4 text-right tabular-nums">{pct(r.accuracy)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5">Saved positions</td>
            <td className="pl-4 text-right tabular-nums">{stats.positions.cards}</td>
            <td className="pl-4 text-right tabular-nums">{stats.positions.reviews}</td>
            <td className="pl-4 text-right tabular-nums">{pct(stats.positions.accuracy)}</td>
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

function Session({
  cards: initial,
  onEnd,
  practice,
}: {
  cards: SessionCard[];
  /** With what each position came to, in practice (training records its grades as it goes). */
  onEnd(results: SolveResult[]): void;
  /** Solving a set as practice: nothing is scheduled, and Next takes the place of the grades. */
  practice?: { name: string };
}) {
  const ws = useWorkspace();
  // The session's cards; one graded Again joins the end to be asked again, as in Anki and Chessable.
  const [cards, setCards] = useState(initial);
  const [index, setIndex] = useState(0);
  const [node, setNode] = useState<MoveNode | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [right, setRight] = useState(0);
  const [results, setResults] = useState<SolveResult[]>([]);
  const [typed, setTyped] = useState('');
  // A card answered wrong stays wrong for scheduling, even when "Try again" then finds the move.
  const [failed, setFailed] = useState(false);
  const [showSolution, setShowSolution] = useState(false);
  // A position whose answer is a line: how many of its moves are played, and the opponent's reply
  // on its way to the board.
  const [progress, setProgress] = useState(0);
  const [replying, setReplying] = useState(false);
  const timers = useRef<number[]>([]);
  // The card on screen, once graded: a double click or a key pressed twice records one review, not two.
  const graded = useRef<number | null>(null);
  const card = cards[index];
  const solution = useMemo(() => (card?.kind === 'saved_position' ? answerLine(card.saved.fen, card.saved.answer) : []), [card]);
  const multi = solution.length > 1;
  /** The position before the solution's move number `p` (0: the saved position itself). */
  const positionBefore = (p: number) => (p === 0 ? at(card!.kind === 'saved_position' ? card!.saved.fen : card!.fen) : solution[p - 1]!);

  // Show the card: for a repertoire card, play the line up to my move, a move at a time.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setOutcome(null);
    setFailed(false);
    setShowSolution(false);
    setProgress(0);
    setReplying(false);
    graded.current = null;
    if (!card) return;
    if (card.kind === 'saved_position') {
      const start = at(card.saved.fen);
      setNode(start);
      // A mate or stalemate saved as a position: there is no move to find, so it says so and goes on.
      const end = gameEnd([start]);
      if (end && (end.kind === 'checkmate' || end.kind === 'stalemate')) {
        setOutcome({ correct: true, suggested: 3, message: `Nothing to find here: ${describeGameEnd(end)}`, detail: 'This position has no legal moves.' });
      }
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
      if (!card || !outcome || card.card === null || graded.current === index) return;
      graded.current = index;
      const correct = outcome.correct && !failed;
      await api.review(card.card.id, g, correct).catch((e: Error) => ws.toast(e.message, true));
      if (correct) setRight((r) => r + 1);
      const again = g === 1 && cards.filter((c) => c.card?.id === card.card.id).length < 3;
      // Reviewed now, so no longer new: it comes back to be answered, not shown (learn mode is once).
      if (again) setCards((list) => [...list, { ...card, card: { ...card.card, state: card.card.state === 0 ? 1 : card.card.state } }]);
      if (index + 1 >= cards.length + (again ? 1 : 0)) onEnd([]);
      else {
        // The answer goes with its card, in the same step: the next card never shows the last one's.
        setOutcome(null);
        setIndex(index + 1);
      }
    },
    [card, outcome, failed, index, cards, onEnd, ws],
  );

  /** Practice: this position is done (`gotIt`: right the first time); on to the next, or the end. */
  const next = useCallback(
    (gotIt: boolean) => {
      if (!card || card.kind !== 'saved_position') return;
      const done = [...results, { saved: card.saved, right: gotIt }];
      setResults(done);
      if (gotIt) setRight((r) => r + 1);
      if (index + 1 >= cards.length) onEnd(done);
      else {
        setOutcome(null);
        setIndex(index + 1);
      }
    },
    [card, results, index, cards, onEnd],
  );

  /** Stop the session (Esc, Stop): a position answered but not yet moved on from still counts. */
  const stop = () => {
    const answered = practice && outcome && !outcome.unjudged && card?.kind === 'saved_position' && !results.some((r) => r.saved === card.saved);
    onEnd(answered ? [...results, { saved: card.saved, right: outcome.correct && !failed }] : results);
  };

  /** Back to the position for another go; the card is already counted as missed. */
  const tryAgain = useCallback(() => {
    if (!card) return;
    setFailed(true);
    setShowSolution(false);
    setOutcome(null);
    // A line goes on from the move that was missed, not from the beginning.
    setNode(card.kind === 'saved_position' && multi ? positionBefore(progress) : at(card.kind === 'saved_position' ? card.saved.fen : card.fen));
  }, [card, multi, progress]);

  // A layout effect: the listener for a new state is in place when the state shows, so a key pressed
  // the moment a result appears reaches it, not the listener of the state before.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialogOpen()) return;
      if (event.key === 'Escape') stop();
      if (!outcome) return;
      const key = event.key.toLowerCase();
      if (outcome.unjudged) {
        if (key === 'y') next(true);
        if (key === 'n') next(false);
        return;
      }
      if (!outcome.correct && key === 't') tryAgain();
      if (!outcome.correct && key === 's' && outcome.solution) setShowSolution(true);
      if (practice) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          next(outcome.correct && !failed);
        }
        return;
      }
      const g = Number(event.key);
      if (g >= 1 && g <= 4) void grade(g as Grade);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void grade(outcome.suggested);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [outcome, grade, onEnd, tryAgain, next, practice, results, failed]);

  const onMove = async (from: string, to: string, promotion?: string) => {
    // While Stockfish checks the answer, the board waits: a second move would land on the card.
    if (!card || !node || outcome || !ready || checking || replying) return;
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
          detail: card.answer.comment ? displayComment(card.answer.comment) : undefined,
        });
      } else if (card.alternatives.some((a) => a.uci === played.uci)) {
        setOutcome({
          correct: true,
          suggested: 2,
          message: `${played.san} is in your repertoire too, but your main move is ${card.answer.san}.`,
          detail: card.answer.comment ? displayComment(card.answer.comment) : undefined,
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
                detail: card.answer.comment ? displayComment(card.answer.comment) : undefined,
                arrow: card.answer.uci,
              }
            : {
                correct: false,
                suggested: 1,
                message: `Your repertoire plays ${card.answer.san} here, not ${played.san}.`,
                detail: card.answer.comment ? displayComment(card.answer.comment) : undefined,
                arrow: card.answer.uci,
              },
        );
      }
      return;
    }
    if (multi) {
      await playSolutionMove(played);
      return;
    }
    setChecking(true);
    try {
      const result = await api.checkMove(card.saved.fen, played.uci, card.saved.answer);
      if (practice && !card.saved.answer?.trim() && !result.engine) {
        setOutcome({
          correct: false,
          unjudged: true,
          suggested: 1,
          message: `You played ${result.san}.`,
          detail: `No answer is saved for this position. ${engineVerdict(result, card.saved.fen)}`.trim(),
        });
        return;
      }
      // Right when it is the written answer, or when Stockfish finds it as good: a second mate, or
      // another move that wins as much, counts, as on Lichess and ChessTempo.
      const engineGood = result.engine?.good === true;
      const correct = result.answerMatch === true || engineGood;
      // A saved answer that is no move of this position is not quoted as one; Stockfish judged instead.
      const answer = answerLine(card.saved.fen, card.saved.answer).length ? card.saved.answer?.trim() : undefined;
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
            : result.answerMatch === false && answer
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

  /** A move in a position whose answer is a line: the line's move goes on (the reply plays itself). */
  async function playSolutionMove(played: MoveNode) {
    if (!card || card.kind !== 'saved_position' || !node) return;
    const expected = solution[progress]!;
    const whole = lineLabel(solution);
    const finish = () =>
      setOutcome({
        correct: true,
        suggested: failed ? 1 : 3,
        message: failed
          ? 'Solved this time.'
          : `Solved: the whole line, ${Math.ceil(solution.length / 2)} move${Math.ceil(solution.length / 2) === 1 ? '' : 's'}.`,
        detail: whole,
      });
    if (played.uci === expected.uci) {
      const reply = solution[progress + 1];
      if (!reply) return finish();
      setReplying(true);
      timers.current.push(
        window.setTimeout(() => {
          setNode(reply);
          setReplying(false);
          if (progress + 2 >= solution.length) finish();
          else setProgress(progress + 2);
        }, 450),
      );
      return;
    }
    // Another move: as good as the line's, by Stockfish, still counts (the drill ends there, since the
    // written line no longer applies).
    setChecking(true);
    try {
      const result = await api.checkMove(node.fen, played.uci, expected.san);
      const rest = solution.slice(progress);
      const solutionShown = { text: `The line: ${lineLabel(rest)}`, uci: expected.uci };
      setOutcome(
        result.engine?.good
          ? {
              correct: true,
              suggested: failed ? 1 : 2,
              message: `${result.san} works too; the line goes ${expected.san}.`,
              detail: engineVerdict(result, node.fen),
              solution: solutionShown,
            }
          : {
              correct: false,
              suggested: 1,
              message: progress === 0 ? `The answer starts ${expected.san}, not ${result.san}.` : `The line goes on ${expected.san}, not ${result.san}.`,
              detail: engineVerdict(result, node.fen),
              solution: solutionShown,
            },
      );
    } catch (e) {
      ws.toast((e as Error).message, true);
    } finally {
      setChecking(false);
    }
  }

  if (!card || !node) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="mb-4 text-lg">Nothing due right now.</p>
        <button type="button" className={primaryClass} onClick={() => onEnd(results)}>
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
        <span className="font-semibold">{practice ? `Solving${practice.name ? ` “${practice.name}”` : ''}` : 'Training'}</span>
        <span className="tabular-nums text-muted">
          {index + 1} / {cards.length} · {right} right
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent" style={{ width: `${(index / cards.length) * 100}%` }} />
        </div>
        <button type="button" className="text-muted hover:text-text" onClick={() => stop()}>
          Stop <kbd>Esc</kbd>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center-safe justify-center-safe gap-8 overflow-auto p-6 md:flex-row">
        <Board node={node} orientation={color} autoShapes={arrows} viewOnly={!ready || !!outcome} onMove={(f, t, p) => void onMove(f, t, p)} onShapes={() => {}} />
        <div className="w-full max-w-sm space-y-4">
          {card.kind === 'repertoire_move' ? (
            <>
              <p className="text-sm text-muted">
                {card.repertoire.color === 'white' ? '♔' : '♚'} {card.repertoire.name}
                {card.card.state === 0 && ' · new'}
                {card.nice && ' · nice to know'}
              </p>
              <p className="text-sm">{lineLabel(card.line.map((san, i) => ({ ply: i + 1, san }))) || 'Starting position'}</p>
              {/* Answered, the result below says how it went: no heading asks for a move any more. */}
              {!outcome && (
                <h2 className="text-xl font-semibold">{!ready ? 'Watch the line…' : learning ? `New move: play ${card.answer.san}` : 'Your move'}</h2>
              )}
              {learning && ready && !outcome && card.answer.comment && <p className="text-sm">{displayComment(card.answer.comment)}</p>}
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                {practice ? 'Practice: your review schedule is not changed.' : `Saved position${card.card?.state === 0 ? ' · new' : ''}`}
              </p>
              <h2 className="text-xl font-semibold [overflow-wrap:anywhere]">{card.saved.title}</h2>
              <p>
                {card.saved.sideToSolve === 'white' ? 'White' : 'Black'} to play.{' '}
                {multi
                  ? `Find the line: move ${Math.floor(progress / 2) + 1} of ${Math.ceil(solution.length / 2)}.`
                  : 'Find the move.'}
              </p>
              {multi && progress > 0 && <p className="text-sm text-muted">{lineLabel(solution.slice(0, progress))}</p>}
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
                for (const t of moveSpellings(text)) {
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
              className="w-full rounded-md border border-field bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
          )}
          {checking && <p className="text-sm text-muted">Checking with Stockfish…</p>}
          {outcome && (
            <div className={`space-y-2 rounded-xl border p-4 ${outcome.unjudged ? 'border-line' : outcome.correct ? 'border-accent' : 'border-danger'}`}>
              <p className={`font-semibold ${outcome.unjudged ? '' : outcome.correct ? 'text-accent' : 'text-danger'}`}>{outcome.message}</p>
              {outcome.detail && <p className="text-sm">{outcome.detail}</p>}
              {showSolution && outcome.solution && <p className="text-sm font-medium">{outcome.solution.text}</p>}
              {!outcome.correct && !outcome.unjudged && (
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
              {outcome.unjudged ? (
                <div className="space-y-2 pt-1">
                  <p className="text-sm font-medium">Did you have it?</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={primaryClass} onClick={() => next(true)}>
                      I had it <kbd>Y</kbd>
                    </button>
                    <button type="button" className={buttonClass} onClick={() => next(false)}>
                      I missed it <kbd>N</kbd>
                    </button>
                  </div>
                </div>
              ) : practice ? (
                <div className="pt-1">
                  <button type="button" className={primaryClass} onClick={() => next(outcome.correct && !failed)}>
                    {index + 1 >= cards.length ? 'Finish' : 'Next'} <kbd>Enter</kbd>
                  </button>
                </div>
              ) : (
                <>
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
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Solving a set on demand: its positions one after another in the set's order, each checked as in
 * training (the written answer, or a move Stockfish finds as good), as practice: nothing is
 * scheduled. The end says how it went and offers the missed positions again.
 */
function SetSolve({ setId }: { setId: string }) {
  const [name, setName] = useState('');
  const [all, setAll] = useState<SavedPosition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A round: the positions to solve this time (the whole set, or the ones missed), numbered so that
  // each round starts afresh.
  const [round, setRound] = useState<{ n: number; items: SavedPosition[] }>({ n: 0, items: [] });
  const [results, setResults] = useState<SolveResult[] | null>(null);
  const back = useCallback(() => navigate(`positions?set=${setId}`), [setId]);

  useEffect(() => {
    // The server lists up to 500 saves at a time; a set is not expected to be bigger.
    api
      .savedPositions({ setId, limit: 5000 })
      .then((d) => {
        setAll(d.positions);
        setRound({ n: 0, items: d.positions });
      })
      .catch((e: Error) => setError(e.message));
    api
      .sets()
      .then((sets) => setName(sets.find((s) => s.id === setId)?.name ?? ''))
      .catch(() => {});
  }, [setId]);

  const cards = useMemo<PracticeCard[]>(() => round.items.map((saved) => ({ kind: 'saved_position', card: null, saved })), [round]);
  const again = (items: SavedPosition[]) => {
    setResults(null);
    setRound((r) => ({ n: r.n + 1, items }));
  };

  useLayoutEffect(() => {
    if (!results) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, back]);

  if (error || (all && all.length === 0)) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-10 text-center">
        <p className="text-lg">{error ?? 'This set has no positions to solve yet.'}</p>
        <button type="button" className={primaryClass} onClick={back}>
          Back to the set
        </button>
      </div>
    );
  }
  if (!all) return <p className="p-10 text-center text-muted">Loading the set…</p>;

  if (!results) {
    return (
      <Session
        key={round.n}
        cards={cards}
        practice={{ name }}
        onEnd={(done) => (done.length ? setResults(done) : back())}
      />
    );
  }

  const firstTime = results.filter((r) => r.right).length;
  const missed = results.filter((r) => !r.right).map((r) => r.saved);
  return (
    <div className="mx-auto max-w-lg space-y-5 p-10">
      <div className="space-y-1">
        <p className="min-w-0 truncate text-sm text-muted" title={name || undefined}>
          {name ? `Solving “${name}”` : 'Solving a set'}
        </p>
        <h2 className="text-xl font-semibold">
          {firstTime === results.length && results.length === round.items.length
            ? results.length === 1
              ? 'Right the first time.'
              : `All ${results.length} right the first time.`
            : `${firstTime} of ${results.length} right the first time.`}
        </h2>
        {results.length < round.items.length && (
          <p className="text-sm text-muted">
            Stopped after {results.length} of {round.items.length} positions.
          </p>
        )}
      </div>
      {missed.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Missed</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {missed.map((saved) => (
              <li key={saved.id}>{saved.title}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {missed.length > 0 && (
          <button type="button" autoFocus className={primaryClass} onClick={() => again(missed)}>
            Again: the {missed.length === 1 ? 'one' : missed.length} missed
          </button>
        )}
        <button type="button" autoFocus={missed.length === 0} className={missed.length ? buttonClass : primaryClass} onClick={() => again(all)}>
          Again: the whole set
        </button>
        <button type="button" className={buttonClass} onClick={back}>
          Back to the set <kbd>Esc</kbd>
        </button>
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
