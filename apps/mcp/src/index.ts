import { backupFolderFor } from '@chess/server/db/backup.ts';
import { databasePath, openDatabase, runMigrations } from '@chess/server/db/client.ts';
import { EngineService } from '@chess/server/src/engineService.ts';
import { loadEnv } from '@chess/server/src/env.ts';
import { chessData } from '@chess/server/src/toolData.ts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createChessMcpServer } from './server.ts';

// Started by the Claude desktop app (see `pnpm --filter @chess/mcp config`).
// stdout carries the MCP protocol, so nothing else may print to it.
loadEnv();
// The coach's key and the Lichess token stay with the app: nothing here uses them.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LICHESS_TOKEN;
const { db, close } = openDatabase();
runMigrations(db, { backupFolder: backupFolderFor(databasePath()) });
const engines = new EngineService(db);
const data = chessData(db);
delete data.openingStats;

const server = createChessMcpServer({
  analyse: (fen, options) => engines.evaluate(fen, options),
  data,
});

const shutdown = async () => {
  await engines.shutdown();
  close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('close', () => void shutdown());

await server.connect(new StdioServerTransport());
