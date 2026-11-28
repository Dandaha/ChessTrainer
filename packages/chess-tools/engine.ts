import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { constants, cpus, setPriority } from 'node:os';
import { createInterface } from 'node:readline';
import { isValidFen } from '@chess/chess-core';
import { Chess } from 'chess.js';
import { type Analysis, type EngineLine, uciToSan } from './score.ts';

export type { Analysis, EngineLine };

/**
 * Stockfish over UCI, as a child process. It runs at below-normal priority
 * with all cores but two and 256 MB of hash, so the PC stays usable.
 * One search at a time; starting a new one stops the previous one.
 */

export interface EngineOptions {
  /** Path to the Stockfish binary. */
  path: string;
  threads?: number;
  hashMb?: number;
}

export interface AnalyseOptions {
  depth?: number;
  /** Milliseconds to think, instead of a depth. */
  movetime?: number;
  multipv?: number;
  /** Called with the lines as they deepen. */
  onUpdate?(analysis: Analysis): void;
  /**
   * The moves that led to the position, from an earlier one (UCI). With them the engine knows which
   * positions have occurred, so it sees a repetition as the draw it is.
   */
  history?: { startFen: string; moves: string[] };
  /** Play at about this Elo (UCI_LimitStrength) rather than at full strength. */
  elo?: number;
}

/**
 * The environment a chess engine runs with: this process's, minus anything secret (the Claude API
 * key, the Lichess token). An engine has no use for them, and the path in Settings can point at any
 * program.
 */
export function engineEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(name)));
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineError';
  }
}

interface Search {
  fen: string;
  multipv: number;
  lines: Map<number, EngineLine>;
  onUpdate?(analysis: Analysis): void;
  resolve(analysis: Analysis): void;
}

export class Engine {
  name = 'Stockfish';
  private readonly process: ChildProcessWithoutNullStreams;
  private search: Search | null = null;
  private waiting: { token: string; resolve(): void }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private exited = false;
  /** Number of the newest search asked for; an older one that has not started yet is skipped. */
  private latest = 0;
  /** The Elo the engine is limited to now; null at full strength. */
  private limited: number | null = null;

  private constructor(process: ChildProcessWithoutNullStreams) {
    this.process = process;
    // Writing to a program that has just ended fails with EPIPE before "exit" is seen; unhandled, that
    // error would take the whole server down. The exit itself is reported through "exit".
    process.stdin.on('error', () => {
      this.exited = true;
    });
    createInterface({ input: process.stdout }).on('line', (line) => this.onLine(line));
    process.on('exit', () => {
      this.exited = true;
      this.finish();
    });
  }

  static async start(options: EngineOptions): Promise<Engine> {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(options.path, [], { stdio: 'pipe', windowsHide: true, env: engineEnvironment() });
    } catch (error) {
      throw new EngineError(`Could not start Stockfish at ${options.path}: ${(error as Error).message}`);
    }
    const failed = new Promise<never>((_, reject) => {
      child.once('error', (error) => reject(new EngineError(`Could not start Stockfish at ${options.path}: ${error.message}`)));
      // A program that is not an engine often just ends: say so at once rather than after the timeout.
      child.once('exit', (code) => reject(new EngineError(`${options.path} stopped (exit code ${code ?? '?'}) before answering as a UCI engine. Is it Stockfish?`)));
    });
    const engine = new Engine(child);
    try {
      if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Not allowed on this system: run at normal priority.
    }
    const ready = (async () => {
      await engine.command('uci', 'uciok');
      engine.send(`setoption name Threads value ${options.threads ?? Math.max(1, cpus().length - 2)}`);
      engine.send(`setoption name Hash value ${options.hashMb ?? 256}`);
      await engine.command('isready', 'readyok');
      return engine;
    })();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new EngineError(`${options.path} did not answer as a UCI engine. Is it Stockfish?`)), 10_000),
    );
    try {
      return await Promise.race([ready, failed, timeout]);
    } catch (error) {
      child.kill();
      throw error;
    }
  }

  get running(): boolean {
    return !this.exited;
  }

  private send(command: string): void {
    if (!this.exited) this.process.stdin.write(`${command}\n`);
  }

  private command(command: string, token: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push({ token, resolve });
      this.send(command);
    });
  }

  private onLine(line: string): void {
    if (line.startsWith('id name ')) this.name = line.slice(8).trim();
    const waiter = this.waiting.find((w) => line.startsWith(w.token));
    if (waiter) {
      this.waiting.splice(this.waiting.indexOf(waiter), 1);
      waiter.resolve();
    }
    const search = this.search;
    if (!search) return;
    if (line.startsWith('bestmove')) {
      this.finish();
      return;
    }
    if (!line.startsWith('info ') || !line.includes(' pv ') || / (lowerbound|upperbound)/.test(line)) return;
    const parts = line.split(' ');
    const at = (key: string) => parts.indexOf(key);
    const depth = Number(parts[at('depth') + 1]);
    const multipv = at('multipv') >= 0 ? Number(parts[at('multipv') + 1]) : 1;
    const scoreAt = at('score');
    const kind = parts[scoreAt + 1];
    const value = Number(parts[scoreAt + 2]);
    const pv = parts.slice(at('pv') + 1);
    // UCI scores are from the side to move; turn them to White's point of view.
    const sign = search.fen.split(' ')[1] === 'b' ? -1 : 1;
    const entry: EngineLine = {
      multipv,
      depth,
      ...(kind === 'mate' ? { mate: sign * value } : { cp: sign * value }),
      pv,
      san: uciToSan(search.fen, pv),
    };
    search.lines.set(multipv, entry);
    // Report once a depth has all its lines (no more than there are legal moves).
    if (multipv === search.multipv || search.lines.size === 1) search.onUpdate?.(this.snapshot(search));
  }

  private snapshot(search: Search): Analysis {
    const lines = [...search.lines.values()].sort((a, b) => a.multipv - b.multipv);
    return { fen: search.fen, engine: this.name, depth: lines[0]?.depth ?? 0, lines };
  }

  private finish(): void {
    const search = this.search;
    if (!search) return;
    this.search = null;
    search.resolve(this.snapshot(search));
  }

  /** Analyses a position. Resolves when the depth or time is reached, or when stopped. */
  analyse(fen: string, options: AnalyseOptions = {}): Promise<Analysis> {
    if (this.exited) return Promise.reject(new EngineError('Stockfish is not running.'));
    // An impossible position would make the engine's lines unreadable mid-search; refuse it here.
    if (!isValidFen(fen)) return Promise.reject(new EngineError('That is not a legal chess position.'));
    this.stop();
    const ticket = ++this.latest;
    const run = this.queue.then(
      () =>
        new Promise<Analysis>((resolve) => {
          if (ticket !== this.latest || this.exited) {
            resolve({ fen, engine: this.name, depth: 0, lines: [] }); // replaced before it started
            return;
          }
          // Never ask for more lines than there are moves: the engine would never send the missing ones.
          const legal = new Chess(fen).moves().length;
          if (legal === 0) {
            resolve({ fen, engine: this.name, depth: 0, lines: [] }); // mate or stalemate: nothing to search
            return;
          }
          const multipv = Math.min(options.multipv ?? 3, legal);
          this.search = { fen, multipv, lines: new Map(), onUpdate: options.onUpdate, resolve };
          this.send(`setoption name MultiPV value ${multipv}`);
          const elo = options.elo ?? null;
          if (elo !== this.limited) {
            this.send(`setoption name UCI_LimitStrength value ${elo ? 'true' : 'false'}`);
            if (elo) this.send(`setoption name UCI_Elo value ${elo}`);
            this.limited = elo;
          }
          const history = options.history;
          this.send(history?.moves.length ? `position fen ${history.startFen} moves ${history.moves.join(' ')}` : `position fen ${fen}`);
          if (options.movetime) this.send(`go movetime ${options.movetime}`);
          else if (options.depth) this.send(`go depth ${options.depth}`);
          else this.send('go infinite');
        }),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stops the current search; its promise resolves with what was found so far. */
  stop(): void {
    if (this.search) this.send('stop');
  }

  async quit(): Promise<void> {
    if (this.exited) return;
    this.stop();
    this.send('quit');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.process.kill();
        resolve();
      }, 1000);
      this.process.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
