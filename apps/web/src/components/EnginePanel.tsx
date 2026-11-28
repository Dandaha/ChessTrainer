import { type GameEnd, describeGameEnd } from '@chess/chess-core';
import { type EngineLine, formatScore } from '@chess/chess-tools/score';
import type { EngineSettings } from '../storage.ts';
import type { EngineState } from '../useEngine.ts';

/** Win share for White from a score, for the eval bar (a smooth curve, not a probability claim). */
export function whiteShare(line?: Pick<EngineLine, 'cp' | 'mate'>): number {
  if (!line) return 0.5;
  if (line.mate !== undefined) return line.mate > 0 ? 1 : 0;
  return 1 / (1 + Math.exp(-(line.cp ?? 0) / 250));
}

/** The bar's own short score: "2.1", "M3", or the result when the game is over. */
function barScore(line: EngineLine | undefined, decided: 'white' | 'black' | 'draw' | undefined): string {
  if (decided) return decided === 'draw' ? '½' : decided === 'white' ? '1-0' : '0-1';
  if (!line) return '';
  if (line.mate !== undefined) return `M${Math.abs(line.mate)}`;
  return (Math.abs(line.cp ?? 0) / 100).toFixed(1);
}

/**
 * `decided`: the game is over on the board, so the bar shows the result rather than a score. White's
 * share fills from White's side (the bottom, or the top when the board is flipped); the score sits at
 * the end of the side that is ahead, as on Lichess, and a tick marks the middle.
 */
export function EvalBar({ line, flipped, decided }: { line?: EngineLine; flipped: boolean; decided?: 'white' | 'black' | 'draw' }) {
  const share = decided ? (decided === 'white' ? 1 : decided === 'black' ? 0 : 0.5) : whiteShare(line);
  const label = decided ? (decided === 'draw' ? 'Draw' : `${decided === 'white' ? 'White' : 'Black'} has won`) : line ? formatScore(line) : '';
  const whiteAhead = share >= 0.5;
  // White's end is the bottom unless the board is flipped; the score goes at the leading side's end.
  const atBottom = whiteAhead !== flipped;
  const score = barScore(line, decided);
  return (
    <div
      className="relative w-5 shrink-0 self-stretch overflow-hidden bg-[#3a3935]"
      aria-label={label ? `Evaluation ${label}` : 'Evaluation'}
      title={label}
    >
      <div
        className={`absolute inset-x-0 bg-[#f4f2ee] transition-[height] duration-300 ${flipped ? 'top-0' : 'bottom-0'}`}
        style={{ height: `${share * 100}%` }}
      />
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#c9442f]/60" aria-hidden />
      {score && (
        <span
          aria-hidden
          className={`absolute inset-x-0 text-center text-[9px] font-semibold tracking-tighter tabular-nums ${atBottom ? 'bottom-0.5' : 'top-0.5'} ${
            whiteAhead ? 'text-[#3a3935]' : 'text-[#f4f2ee]'
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/** Move numbers for a line from a position: "9…Kd8 10.O-O-O+ Kc7" (a number on White's moves and on the first). */
function numbered(fen: string, sans: string[]): string[] {
  const [, turn, , , , full] = fen.split(' ');
  const blackFirst = turn === 'b';
  const start = Number(full) || 1;
  return sans.map((san, i) => {
    const offset = i + (blackFirst ? 1 : 0);
    const number = start + Math.floor(offset / 2);
    if (offset % 2 === 0) return `${number}.${san}`;
    return i === 0 ? `${number}…${san}` : san;
  });
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
  gameOver = null,
  onPlayLine,
  onTurnOff,
  playHint = "plays the top line's first move.",
}: {
  state: EngineState;
  /**
   * How the game ended at this position, if it did. The game's verdict is then the evaluation (0.00
   * for a draw), and the engine's lines are shown as what would follow if the game went on.
   */
  gameOver?: GameEnd | null;
  settings: EngineSettings;
  onSettings(settings: EngineSettings): void;
  /** Threat mode: on or off, and whose threats ('Black' when White is to move), or null in check. */
  threat: { on: boolean; side: 'White' | 'Black' | null; onToggle(): void };
  onPlayLine(sans: string[]): void;
  onTurnOff(): void;
  /** What Space and a click on a line's move do here (the board plays them; the repertoire adds them). */
  playHint?: string;
}) {
  const { analysis, status, error } = state;
  const showingThreat = threat.on && threat.side !== null;
  return (
    <div className="space-y-2 p-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>
          {analysis ? `${analysis.engine}${analysis.depth ? ` · depth ${analysis.depth}` : ''}` : 'Stockfish'}
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
      {gameOver && (
        <div className="flex gap-2 rounded-md bg-surface-2 px-2 py-1.5" aria-label="Evaluation">
          <span className="w-12 shrink-0 font-semibold tabular-nums">{gameOver.kind === 'checkmate' ? gameOver.result : '0.00'}</span>
          <span>{describeGameEnd(gameOver)}</span>
        </div>
      )}
      {gameOver && analysis?.lines.length ? <p className="text-xs text-muted">If the game goes on:</p> : null}
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
      {!gameOver && analysis?.lines.length === 0 && status === 'done' && <p className="text-muted">No legal moves: the game is over.</p>}
      {/* One row per line: the score in a chip, then the moves numbered from this position, cut
          short at the panel's edge (the whole line on hover). */}
      <ol className="space-y-1">
        {analysis?.lines.map((line) => {
          const moves = numbered(analysis.fen, line.san.slice(0, 12));
          return (
            <li key={line.multipv} className="flex items-baseline gap-2" title={moves.join(' ')}>
              <span
                className={`w-14 shrink-0 rounded bg-surface-2 py-0.5 text-center text-xs font-semibold tabular-nums ${showingThreat ? 'text-danger' : ''}`}
              >
                {formatScore(line)}
              </span>
              <span className="min-w-0 truncate whitespace-nowrap leading-6">
                {showingThreat
                  ? moves.join(' ')
                  : moves.map((label, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => onPlayLine(line.san.slice(0, i + 1))}
                        className="mr-0.5 rounded px-0.5 hover:bg-surface-2"
                      >
                        {label}
                      </button>
                    ))}
              </span>
            </li>
          );
        })}
      </ol>
      {!showingThreat && analysis?.lines.length ? (
        <p className="text-xs text-muted">
          <kbd>Space</kbd> {playHint}
        </p>
      ) : null}
    </div>
  );
}
