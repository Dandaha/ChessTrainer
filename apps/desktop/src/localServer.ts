import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Engine } from '@chess/chess-tools';
import { backupFolderFor, backupIfDue } from '@chess/server/db/backup.ts';
import { databasePath, openDatabase, runMigrations } from '@chess/server/db/client.ts';
import { purgeTrash } from '@chess/server/db/library.ts';
import { buildApp } from '@chess/server/src/app.ts';
import { deriveMissingInBackground } from '@chess/server/db/games.ts';
import { addStarterConceptsOnce } from '@chess/server/db/starterLibrary.ts';
import { EngineService } from '@chess/server/src/engineService.ts';
import { envFilePath, loadEnv } from '@chess/server/src/env.ts';
import { serveWeb } from '@chess/server/src/staticWeb.ts';
import { type Updates, updateRoutes } from '@chess/server/src/updates.ts';

/**
 * The app's own server, started by the desktop app: the API and the built web
 * pages on one local port. Everything personal (database, API key) lives in
 * the app's data folder, not next to the program.
 */

export interface LocalServerOptions {
  /** Where the database and the .env with the API key live. */
  dataDir: string;
  /** The built web app. */
  webDir: string;
  /** Folder with the bundled Stockfish builds, if any. */
  stockfishDir?: string;
  /** How the Claude desktop app can start the MCP server: this program and the script. */
  mcp?: { command: string; script: string; env?: Record<string, string> };
  /** The app's updates, shown in Settings. */
  updates?: Updates;
}

/** A fixed port, so the page keeps the same address (and its saved theme and draft) between starts. */
const PORTS = [47123, 47124, 47125, 47126, 47127];

/**
 * The Stockfish programs in the bundled folder, most likely to be the right one first:
 * Stockfish 19 and later ship one "universal" build that picks the CPU's fastest code
 * itself; older releases had an AVX2 build and a plain one.
 */
function stockfishCandidates(dir: string): string[] {
  const windows = process.platform === 'win32';
  const rank = (name: string) => (/universal/i.test(name) ? 0 : /avx2/i.test(name) ? 1 : /^stockfish(\.exe)?$/i.test(name) ? 3 : 2);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^stockfish/i.test(entry.name) && (windows ? /\.exe$/i.test(entry.name) : !entry.name.includes('.')))
    .map((entry) => entry.name)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => join(dir, name));
}

/** The first bundled Stockfish this computer can run. */
async function pickStockfish(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  for (const path of stockfishCandidates(dir)) {
    try {
      const engine = await Engine.start({ path, threads: 1, hashMb: 16 });
      await engine.quit();
      return path;
    } catch {
      // This build does not run here (e.g. it needs a newer CPU): try the next one.
    }
  }
  return null;
}

export async function startLocalServer(options: LocalServerOptions): Promise<{ url: string; close(): Promise<void> }> {
  mkdirSync(options.dataDir, { recursive: true });
  process.env.DATABASE_PATH ??= join(options.dataDir, 'chess.db');
  process.env.CHESS_ENV_FILE ??= join(options.dataDir, '.env');
  loadEnv();

  const { db, close: closeDb } = openDatabase();
  // A backup before an update changes the database, and one a week anyway (data folder/backups).
  const backupFolder = backupFolderFor(databasePath());
  runMigrations(db, { backupFolder });
  backupIfDue(db, backupFolder);
  purgeTrash(db);
  // The built-in chess concepts, once per library.
  addStarterConceptsOnce(db);
  const engines = new EngineService(db);
  // Warnings and server errors go to server.log in the data folder, where a problem can be traced.
  const app = buildApp(db, engines, undefined, { logFile: join(options.dataDir, 'server.log') });
  if (options.updates) updateRoutes(app, options.updates);

  // Stockfish comes with the app; Settings can still point to another binary.
  const stockfish = options.stockfishDir && !process.env.STOCKFISH_PATH ? pickStockfish(options.stockfishDir) : Promise.resolve(null);
  void stockfish.then((path) => {
    if (path) {
      process.env.STOCKFISH_PATH = path;
      process.env.STOCKFISH_BUNDLED = '1';
    }
  });

  app.get('/api/system/info', async () => {
    const engine = await stockfish;
    return {
      desktop: true,
      dataDir: options.dataDir,
      databasePath: databasePath(),
      envFile: envFilePath(),
      mcpConfig: options.mcp
        ? {
            mcpServers: {
              chess: {
                command: options.mcp.command,
                args: [options.mcp.script],
                env: {
                  ...options.mcp.env,
                  DATABASE_PATH: databasePath(),
                  ...(engine ? { STOCKFISH_PATH: engine } : {}),
                },
              },
            },
          }
        : null,
    };
  });
  serveWeb(app, options.webDir);

  let port = 0;
  for (const candidate of PORTS) {
    try {
      await app.listen({ host: '127.0.0.1', port: candidate });
      port = candidate;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }
  if (!port) {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    port = typeof address === 'object' && address ? address.port : 0;
  }

  // Games from an older version get their opening and content key, a batch at a time.
  void deriveMissingInBackground(db);

  return {
    url: `http://127.0.0.1:${port}/`,
    close: async () => {
      await app.close();
      closeDb();
    },
  };
}
