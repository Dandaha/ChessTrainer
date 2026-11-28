import { existsSync } from 'node:fs';
import { type Analysis, Engine, EngineError } from '@chess/chess-tools';
import type { Db } from '../db/client.ts';
import { bestCachedAnalysis, cachedAnalysis, storeAnalysis } from '../db/engineCache.ts';
import { getSettings } from '../db/library.ts';

/**
 * Owns the Stockfish processes. They start when first needed and quit after
 * two idle minutes, so nothing runs while no analysis is open. The analysis
 * panel and the tools (training checks, coach) each get their own process, so
 * one never stops the other's search.
 */

const IDLE_MS = 120_000;

type Purpose = 'panel' | 'tools';

export interface EngineStatus {
  configured: boolean;
  /** The engine that comes with the desktop app, used when Settings names none. */
  bundled: boolean;
  path: string | null;
  running: boolean;
  name: string | null;
  error?: string;
}

export class EngineService {
  private engines = new Map<Purpose, { engine: Engine; path: string; idle?: NodeJS.Timeout }>();
  private starting = new Map<Purpose, Promise<Engine>>();
  private lastName: string | null = null;

  constructor(private readonly db: Db) {}

  path(): string | null {
    const fromSettings = getSettings(this.db).enginePath;
    return (typeof fromSettings === 'string' && fromSettings.trim()) || process.env.STOCKFISH_PATH || null;
  }

  private async get(purpose: Purpose): Promise<Engine> {
    const path = this.path();
    if (!path) throw new EngineError('No engine yet: set the path to Stockfish in Settings.');
    const current = this.engines.get(purpose);
    if (current && current.engine.running && current.path === path) {
      this.touch(purpose);
      return current.engine;
    }
    if (current) await this.stopEngine(purpose);
    const pending = this.starting.get(purpose);
    if (pending) return pending;
    if (!existsSync(path)) throw new EngineError(`There is no file at ${path}. Check the Stockfish path in Settings.`);
    const start = Engine.start({ path })
      .then((engine) => {
        this.engines.set(purpose, { engine, path });
        this.lastName = engine.name;
        this.touch(purpose);
        return engine;
      })
      .finally(() => this.starting.delete(purpose));
    this.starting.set(purpose, start);
    return start;
  }

  /** Restarts the idle countdown after use. */
  private touch(purpose: Purpose): void {
    const entry = this.engines.get(purpose);
    if (!entry) return;
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => void this.stopEngine(purpose), IDLE_MS);
    entry.idle.unref?.();
  }

  private async stopEngine(purpose: Purpose): Promise<void> {
    const entry = this.engines.get(purpose);
    if (!entry) return;
    this.engines.delete(purpose);
    clearTimeout(entry.idle);
    await entry.engine.quit();
  }

  /** Starts the program at `path` once to see that it answers as a UCI engine; returns its name. */
  async test(path: string): Promise<string> {
    if (!existsSync(path)) throw new EngineError(`There is no file at ${path}.`);
    const engine = await Engine.start({ path, threads: 1, hashMb: 16 });
    const name = engine.name;
    await engine.quit();
    return name;
  }

  async status(): Promise<EngineStatus> {
    const path = this.path();
    const fromSettings = getSettings(this.db).enginePath;
    const bundled = !(typeof fromSettings === 'string' && fromSettings.trim()) && process.env.STOCKFISH_BUNDLED === '1';
    if (!path) return { configured: false, bundled: false, path: null, running: false, name: null };
    try {
      const engine = await this.get('tools');
      return { configured: true, bundled, path, running: engine.running, name: engine.name };
    } catch (error) {
      return { configured: true, bundled, path, running: false, name: null, error: (error as Error).message };
    }
  }

  /** A fixed-depth analysis, from the cache when it is deep enough. */
  async evaluate(fen: string, options: { depth?: number; multipv?: number } = {}): Promise<Analysis> {
    // One at a time: a second evaluation would stop the first mid-search, which would then come back
    // shallow (and be cached as if it were deep).
    const turn = this.toolsTurn.then(() => this.evaluateNow(fen, options));
    this.toolsTurn = turn.catch(() => undefined);
    return turn;
  }

  private toolsTurn: Promise<unknown> = Promise.resolve();

  private async evaluateNow(fen: string, options: { depth?: number; multipv?: number }): Promise<Analysis> {
    const depth = options.depth ?? 18;
    const multipv = options.multipv ?? 3;
    const engine = await this.get('tools');
    const cached = cachedAnalysis(this.db, fen, engine.name, depth, multipv);
    if (cached) return cached;
    const analysis = await engine.analyse(fen, { depth, multipv });
    this.touch('tools');
    // Only a search that reached its depth is worth keeping.
    if (analysis.depth >= depth) storeAnalysis(this.db, analysis);
    return analysis;
  }

  /**
   * Live analysis for the panel: calls onUpdate as the search deepens, from a
   * cached result first if there is one. The returned function stops it.
   */
  async stream(
    fen: string,
    multipv: number,
    onUpdate: (analysis: Analysis) => void,
    onDone: (analysis: Analysis) => void,
    /** The moves since the last capture or pawn move, when the position has occurred among them. */
    history?: { startFen: string; moves: string[] },
    /** How deep to search (40 unless given), and an Elo to play at instead of full strength. */
    settings: { depth?: number; elo?: number } = {},
  ): Promise<() => void> {
    const engine = await this.get('panel');
    const depth = settings.depth ?? 40;
    // A repeated position is judged with its history (a draw by repetition), and a weakened engine
    // by its strength, so neither the cache's view of it nor this one belongs to the position alone.
    const ownView = Boolean(history?.moves.length) || settings.elo !== undefined;
    const cached = ownView ? undefined : bestCachedAnalysis(this.db, fen, engine.name);
    if (cached && cached.lines.length >= multipv) {
      const known = { ...cached, lines: cached.lines.slice(0, multipv) };
      // Already searched as deep as asked: nothing to run.
      if (cached.depth >= depth) {
        onDone(known);
        return () => {};
      }
      onUpdate(known);
    }
    let stopped = false;
    const run = engine.analyse(fen, {
      multipv,
      depth,
      elo: settings.elo,
      history,
      onUpdate: (analysis) => {
        // Still in use: keep the idle timer from stopping the engine under an open panel.
        this.touch('panel');
        if (!stopped && (!cached || analysis.depth > cached.depth)) onUpdate(analysis);
      },
    });
    void run.then((analysis) => {
      if (!ownView) storeAnalysis(this.db, analysis);
      this.touch('panel');
      if (!stopped) onDone(analysis);
    });
    return () => {
      stopped = true;
      engine.stop();
      this.touch('panel');
    };
  }

  /** The engine name last seen, for cache lookups without starting it. */
  engineName(): string | null {
    return this.lastName;
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.stopEngine('panel'), this.stopEngine('tools')]);
  }
}
