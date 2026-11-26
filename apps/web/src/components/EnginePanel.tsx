import { type EngineLine, formatScore } from '@chess/chess-tools/score';
import type { EngineState } from '../useEngine.ts';

/** Win share for White from a score, for the eval bar (a smooth curve, not a probability claim). */
export function whiteShare(line?: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (!line) return 0.5;
  if (line.mate !== undefined) return line.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-(line.cp ?? 0) / 250));
}

export function EvalBar({ line, flipped }: { line?: EngineLine; flipped: boolean }) {
  const share = whiteShare(line);
  return (
    <div
      className={`relative w-3 shrink-0 self-stretch overflow-hidden rounded-sm border border-[#7a776f] bg-[#2b2a27] ${flipped ? 'rotate-180' : ''}`}
      aria-label={line ? `Evaluation ${formatScore(line)}` : 'Evaluation'}
      title={line ? formatScore(line) : ''}
    >
      <div className="absolute inset-x-0 bottom-0 bg-[#f4f2ee] transition-[height] duration-300" style={{ height: `${share * 100}%` }} />
    </div>
  );
}

/** The engine tab: score, depth and the best lines, each move clickable. */
export function EnginePanel({
  state,
  onPlayLine,
  onTurnOff,
}: {
  state: EngineState;
  onPlayLine(sans: string[]): void;
  onTurnOff(): void;
}) {
  const { analysis, status, error } = state;
  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {analysis ? `${analysis.engine} · depth ${analysis.depth}` : 'Stockfish'}
          {status === 'running' && ' · thinking…'}
          {status === 'starting' && ' · starting…'}
        </span>
        <button type="button" className="text-accent" onClick={onTurnOff} title="Engine off (E)">
          Turn off <kbd>E</kbd>
        </button>
      </div>
      {error && (
        <p className="text-danger">
          {error}{' '}
          {/Settings/.test(error) && (
            <a href="#/settings" className="text-accent underline">
              Open Settings
            </a>
          )}
        </p>
      )}
      {analysis?.lines.length === 0 && status === 'done' && <p className="text-muted">No legal moves: the game is over.</p>}
      <ol className="space-y-1">
        {analysis?.lines.map((line) => (
          <li key={line.multipv} className="flex gap-2">
            <span className="w-12 shrink-0 font-semibold tabular-nums">{formatScore(line)}</span>
            <span className="min-w-0 leading-6">
              {line.san.slice(0, 12).map((san, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => onPlayLine(line.san.slice(0, i + 1))}
                  className="mr-1 rounded px-0.5 hover:bg-surface-2"
                >
                  {san}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
