import { type EngineLine, formatScore } from '@chess/chess-tools/score';
import type { EngineSettings } from '../storage.ts';
import type { EngineState } from '../useEngine.ts';

/** Win share for White from a score, for the eval bar (a smooth curve, not a probability claim). */
export function whiteShare(line?: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (!line) return 0.5;
  if (line.mate !== undefined) return line.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-(line.cp ?? 0) / 250));
}

/** `decided`: the game is over on the board, so the bar shows the result rather than a score. */
export function EvalBar({ line, flipped, decided }: { line?: EngineLine; flipped: boolean; decided?: 'white' | 'black' | 'draw' }) {
  const share = decided ? (decided === 'white' ? 1 : decided === 'black' ? 0 : 0.5) : whiteShare(line);
  const label = decided ? (decided === 'draw' ? 'Draw' : `${decided === 'white' ? 'White' : 'Black'} has won`) : line ? formatScore(line) : '';
  return (
    <div
      className={`relative w-3 shrink-0 self-stretch overflow-hidden rounded-sm border border-[#7a776f] bg-[#2b2a27] ${flipped ? 'rotate-180' : ''}`}
      aria-label={label ? `Evaluation ${label}` : 'Evaluation'}
      title={label}
    >
      <div className="absolute inset-x-0 bottom-0 bg-[#f4f2ee] transition-[height] duration-300" style={{ height: `${share * 100}%` }} />
    </div>
  );
}

const DEPTHS = [16, 20, 24, 30, 40];
const STRENGTHS = [2800, 2500, 2200, 1900, 1600, 1350];
const small = 'rounded border border-field bg-surface px-1 py-0.5 text-xs text-text';

/**
 * The engine tab: score, depth and the best lines, each move clickable; the settings (lines, depth,
 * strength); and threat mode, which shows what the opponent would play if it were their move.
 */
export function EnginePanel({
  state,
  settings,
  onSettings,
  threat,
  onPlayLine,
  onTurnOff,
}: {
  state: EngineState;
  settings: EngineSettings;
  onSettings(settings: EngineSettings): void;
  /** Threat mode: on or off, and whose threats ('Black' when White is to move), or null in check. */
  threat: { on: boolean; side: 'White' | 'Black' | null; onToggle(): void };
  onPlayLine(sans: string[]): void;
  onTurnOff(): void;
}) {
  const { analysis, status, error } = state;
  const showingThreat = threat.on && threat.side !== null;
  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {analysis ? `${analysis.engine} · depth ${analysis.depth}` : 'Stockfish'}
          {settings.elo ? ` · ${settings.elo} Elo` : ''}
          {status === 'running' && ' · thinking…'}
          {status === 'starting' && ' · starting…'}
        </span>
        <button type="button" className="text-accent" onClick={onTurnOff} title="Engine off (E)">
          Turn off <kbd>E</kbd>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <label className="flex items-center gap-1">
          Lines
          <select aria-label="Lines" className={small} value={settings.lines} onChange={(e) => onSettings({ ...settings, lines: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Depth
          <select aria-label="Depth" className={small} value={settings.depth} onChange={(e) => onSettings({ ...settings, depth: Number(e.target.value) })}>
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Strength
          <select
            aria-label="Strength"
            className={small}
            value={settings.elo ?? ''}
            onChange={(e) => onSettings({ ...settings, elo: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">Full</option>
            {STRENGTHS.map((elo) => (
              <option key={elo} value={elo}>
                {elo} Elo
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={threat.on}
          className={`rounded border px-1.5 py-0.5 ${threat.on ? 'border-danger text-danger' : 'border-line hover:bg-surface-2'}`}
          onClick={threat.onToggle}
          title="Show what the opponent threatens (T)"
        >
          Threat <kbd>T</kbd>
        </button>
      </div>
      {threat.on && (
        <p className="text-xs text-danger">
          {threat.side
            ? `Threat: what ${threat.side} would play if it were ${threat.side}'s move.`
            : 'No threat to show while in check: these are the lines for the position itself.'}
        </p>
      )}
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
            <span className={`w-12 shrink-0 font-semibold tabular-nums ${showingThreat ? 'text-danger' : ''}`}>{formatScore(line)}</span>
            <span className="min-w-0 leading-6">
              {showingThreat
                ? line.san.slice(0, 12).join(' ')
                : line.san.slice(0, 12).map((san, i) => (
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
      {!showingThreat && analysis?.lines.length ? (
        <p className="text-xs text-muted">
          <kbd>Space</kbd> plays the top line's first move.
        </p>
      ) : null}
    </div>
  );
}
