import { type Game, type MoveNode, mainlineFrom } from '@chess/chess-core';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  type Annotations,
  type CoachEvent,
  type CoachHistoryItem,
  type CoachMode,
  type ReviewMoment,
  type Suggestions,
  type Usage,
  api,
} from '../api.ts';
import { Markdown } from './Markdown.tsx';
import { buttonClass, inputClass, primaryClass } from './ui.tsx';

/**
 * The coach next to the board: quick buttons, a free question, the answer
 * streaming in, arrows on the board, clickable lines, and the tokens used.
 */

export interface CoachPanelHandle {
  focusQuestion(): void;
}

interface Answer {
  /** The position the answer is about. */
  nodeId: string;
  question: string;
  text: string;
  status: string | null;
  annotations: Annotations | null;
  suggestions: Suggestions | null;
  moments: ReviewMoment[] | null;
  done: { model: string; usage: Usage; costUsd: number } | null;
  error: string | null;
}

const BUTTONS: { mode: CoachMode; label: string }[] = [
  { mode: 'explain_move', label: 'Explain this move' },
  { mode: 'plan', label: 'What’s the plan?' },
  { mode: 'explain_opening', label: 'Explain this opening' },
  { mode: 'tag_position', label: 'Tag this position' },
];

const SHORT: Record<string, string> = {
  'claude-haiku-5-5': 'Haiku 5.5',
  'claude-sonnet-5-5': 'Sonnet 5.5',
  'claude-opus-5-5': 'Opus 5.5',
};

export const CoachPanel = forwardRef<
  CoachPanelHandle,
  {
    game: Game;
    path: MoveNode[];
    myColor?: 'white' | 'black';
    onAnnotations(annotations: Annotations | null): void;
    /** Plays a line from the node the answer is about. */
    onPlayLine(nodeId: string, sans: string[]): void;
    onGoToPly(ply: number): void;
    onGoTo(nodeId: string): void;
  }
>(function CoachPanel({ game, path, myColor, onAnnotations, onPlayLine, onGoToPly, onGoTo }, ref) {
  const current = path.at(-1)!;
  const [connected, setConnected] = useState<boolean | null>(null);
  const [history, setHistory] = useState<CoachHistoryItem[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [candidate, setCandidate] = useState('');
  const [deep, setDeep] = useState(false);
  const questionBox = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({ focusQuestion: () => questionBox.current?.focus() }), []);

  useEffect(() => {
    api.coachStatus().then((s) => setConnected(s.connected)).catch(() => setConnected(false));
  }, []);

  // A new position: the arrows go (they were about the old one); the answer stays readable.
  useEffect(() => {
    if (answer?.nodeId !== current.id) onAnnotations(null);
    api.coachHistory(current.fen).then(setHistory).catch(() => setHistory([]));
  }, [current.fen]);

  const request = (mode: CoachMode, extra: { question?: string; candidate?: string } = {}) => ({
    mode,
    fen: current.fen,
    startFen: game.root.fen,
    moves: path.slice(1).map((n) => n.san),
    myColor,
    deep,
    ...extra,
  });

  const run = async (label: string, start: (onEvent: (e: CoachEvent) => void) => Promise<void>) => {
    setBusy(true);
    const fresh: Answer = { nodeId: current.id, question: label, text: '', status: null, annotations: null, suggestions: null, moments: null, done: null, error: null };
    setAnswer(fresh);
    const update = (change: Partial<Answer>) => setAnswer((a) => ({ ...(a ?? fresh), ...change }));
    try {
      await start((e) => {
        if (e.type === 'text') setAnswer((a) => ({ ...(a ?? fresh), text: (a?.text ?? '') + e.text, status: null }));
        else if (e.type === 'status') update({ status: e.text });
        else if (e.type === 'annotations') {
          update({ annotations: e.annotations });
          onAnnotations(e.annotations);
        } else if (e.type === 'suggestions') update({ suggestions: e.suggestions });
        else if (e.type === 'moments') update({ moments: e.moments });
        else if (e.type === 'done') update({ done: { model: e.model, usage: e.usage, costUsd: e.costUsd }, status: null });
        else if (e.type === 'error') update({ error: e.error, status: null });
      });
    } catch (error) {
      update({ error: (error as Error).message, status: null });
    } finally {
      setBusy(false);
    }
  };

  const ask = (mode: CoachMode, label: string, extra: { question?: string; candidate?: string } = {}) =>
    void run(label, (onEvent) => api.askCoach(request(mode, extra), onEvent));

  if (connected === false) {
    return (
      <div className="space-y-2 p-3 text-sm">
        <p>Coach not connected - add an API key in Settings</p>
        <a href="#/settings" className="text-accent underline">
          Open Settings
        </a>
        <p className="text-xs text-muted">
          The key is your own Anthropic API key; Settings says where it is kept. The engine, the library and
          training all work without it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 text-sm">
      <div className="flex flex-wrap gap-1">
        {BUTTONS.map((b) => (
          <button key={b.mode} type="button" disabled={busy} className={buttonClass} onClick={() => ask(b.mode, b.label)}>
            {b.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy || path.length < 3}
          className={buttonClass}
          title={path.length < 3 ? 'Load a game first' : 'Finds the biggest mistakes with Stockfish, then explains them'}
          onClick={() => {
            const moves = mainlineFrom(game.root).slice(1).map((n) => n.san);
            void run('Review this game', (onEvent) => api.reviewGame({ startFen: game.root.fen, moves, myColor }, onEvent));
          }}
        >
          Review this game
        </button>
      </div>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (candidate.trim()) ask('why_not', `Why not ${candidate.trim()}?`, { candidate: candidate.trim() });
        }}
      >
        <input aria-label="Why not this move" className={`${inputClass} min-w-0 flex-1`} placeholder="Why not… (a move, e.g. Nxe5)" value={candidate} onChange={(e) => setCandidate(e.target.value)} />
        <button type="submit" className={buttonClass} disabled={busy || !candidate.trim()}>
          Ask
        </button>
      </form>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) {
            ask('ask', question.trim(), { question: question.trim() });
            setQuestion('');
          }
        }}
      >
        <textarea
          ref={questionBox}
          aria-label="Ask the coach"
          rows={2}
          className={`${inputClass} w-full`}
          placeholder="Ask about this position…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-xs text-muted">
            <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Think deeper (slower model)
          </label>
          <button type="submit" className={primaryClass} disabled={busy || !question.trim()}>
            Ask <kbd>Enter</kbd>
          </button>
        </div>
      </form>

      {answer && (
        <AnswerView
          answer={answer}
          fen={path.find((n) => n.id === answer.nodeId)?.fen ?? current.fen}
          elsewhere={answer.nodeId !== current.id}
          onPlayLine={(sans) => onPlayLine(answer.nodeId, sans)}
          onGoToPly={onGoToPly}
          onBack={() => onGoTo(answer.nodeId)}
          onShowAgain={() => {
            onGoTo(answer.nodeId);
            if (answer.annotations) onAnnotations(answer.annotations);
          }}
        />
      )}

      {history.length > 0 && !busy && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Earlier answers about this position ({history.filter((h) => h.role === 'assistant').length})</summary>
          <div className="mt-2 space-y-3">
            {history.map((h) =>
              h.role === 'user' ? (
                <p key={h.id} className="font-semibold">
                  {h.content}
                </p>
              ) : (
                <div key={h.id} className="space-y-1 border-l-2 border-line pl-2">
                  <Markdown text={h.content} fen={current.fen} />
                  <p className="text-muted">
                    {SHORT[h.model ?? ''] ?? h.model} · {h.inputTokens.toLocaleString()} in · {h.outputTokens.toLocaleString()} out
                  </p>
                </div>
              ),
            )}
          </div>
        </details>
      )}
    </div>
  );
});

function AnswerView({
  answer,
  fen,
  elsewhere,
  onPlayLine,
  onGoToPly,
  onBack,
  onShowAgain,
}: {
  answer: Answer;
  fen: string;
  elsewhere: boolean;
  onPlayLine(sans: string[]): void;
  onGoToPly(ply: number): void;
  onBack(): void;
  onShowAgain(): void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-bg p-3" aria-live="polite">
      <p className="text-xs font-semibold text-muted">{answer.question}</p>
      {elsewhere && (
        <p className="text-xs text-muted">
          This answer is about an earlier position.{' '}
          <button type="button" className="text-accent" onClick={onBack}>
            Go back to it
          </button>
        </p>
      )}
      {answer.moments && answer.moments.length > 0 && (
        <ul className="space-y-0.5">
          {answer.moments.map((m) => (
            <li key={m.ply}>
              <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onGoToPly(m.ply)}>
                {m.move}
              </button>{' '}
              <span className="text-xs text-muted">
                {m.before} → {m.after} · better was {m.best}
              </span>
            </li>
          ))}
        </ul>
      )}
      {answer.text && <Markdown text={answer.text} fen={fen} />}
      {answer.status && <p className="text-xs text-muted">{answer.status}</p>}
      {!answer.text && !answer.status && !answer.error && !answer.done && <p className="text-xs text-muted">Thinking…</p>}
      {answer.annotations && answer.annotations.lines.length > 0 && (
        <div className="space-y-1">
          {answer.annotations.lines.map((line, i) => (
            <button key={i} type="button" onClick={() => onPlayLine(line.moves)} className="block text-left text-xs hover:text-accent">
              <span className="font-semibold">{line.label}:</span> {line.moves.join(' ')} ▸
            </button>
          ))}
          <button type="button" className="text-xs text-muted hover:text-text" onClick={onShowAgain}>
            Show the arrows again
          </button>
        </div>
      )}
      {answer.suggestions && <SuggestionsView suggestions={answer.suggestions} fen={fen} />}
      {answer.error && (
        <p role="alert" className="text-danger">
          {answer.error}
        </p>
      )}
      {answer.done && answer.done.model && (
        <p className="text-xs text-muted">
          {SHORT[answer.done.model] ?? answer.done.model} · {(answer.done.usage.input + answer.done.usage.cacheRead + answer.done.usage.cacheWrite).toLocaleString()} tokens in
          {answer.done.usage.cacheRead ? ` (${answer.done.usage.cacheRead.toLocaleString()} from cache)` : ''} · {answer.done.usage.output.toLocaleString()} out · ≈ $
          {answer.done.costUsd < 0.01 ? answer.done.costUsd.toFixed(4) : answer.done.costUsd.toFixed(2)}
        </p>
      )}
    </div>
  );
}

/** "Tag this position": link the suggested concepts and add the tags, once confirmed. */
function SuggestionsView({ suggestions, fen }: { suggestions: Suggestions; fen: string }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const mark = (key: string) => setDone((d) => new Set(d).add(key));

  const linkConcept = async (title: string, create: boolean) => {
    const found = (await api.concepts({ q: title })).find((c) => c.title.toLowerCase() === title.toLowerCase());
    const concept = found ?? (create ? await api.createConcept({ title }) : null);
    if (concept) await api.linkConcept(concept.id, 'position', { fen });
    mark(`c:${title}`);
  };

  const addTags = async () => {
    const saves = (await api.savedPositions({ fen, limit: 50 })).positions;
    for (const s of saves) await api.updateSavedPosition(s.id, { tags: [...new Set([...s.tags, ...suggestions.tags])] });
    mark(saves.length ? 'tags' : 'no-saves');
  };

  return (
    <div className="space-y-2 border-t border-line pt-2 text-xs">
      {[...suggestions.concepts.map((t) => [t, false] as const), ...suggestions.newConcepts.map((t) => [t, true] as const)].map(([title, isNew]) => (
        <div key={title} className="flex items-center justify-between gap-2">
          <span>
            {title} {isNew && <span className="text-muted">(new)</span>}
          </span>
          <button type="button" disabled={done.has(`c:${title}`)} className="text-accent disabled:text-muted" onClick={() => void linkConcept(title, isNew)}>
            {done.has(`c:${title}`) ? 'Linked' : isNew ? 'Create and link' : 'Link to this position'}
          </button>
        </div>
      ))}
      {suggestions.tags.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          <span>{suggestions.tags.map((t) => `#${t}`).join(' ')}</span>
          <button type="button" disabled={done.has('tags')} className="text-accent disabled:text-muted" onClick={() => void addTags()}>
            {done.has('tags') ? 'Added' : done.has('no-saves') ? 'Save the position first (S)' : 'Add to my saves of this position'}
          </button>
        </div>
      )}
    </div>
  );
}
