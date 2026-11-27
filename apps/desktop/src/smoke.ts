// Runs the desktop app's server under plain Node, for checking the bundle without Electron.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from './localServer.ts';

const here = dirname(fileURLToPath(import.meta.url));
const server = await startLocalServer({
  dataDir: process.env.SMOKE_DATA_DIR || mkdtempSync(join(tmpdir(), 'chess-desktop-')),
  webDir: join(here, 'web'),
  stockfishDir: process.env.SMOKE_STOCKFISH_DIR,
  mcp: { command: process.execPath, script: join(here, 'mcp.mjs') },
});
console.log(`READY ${server.url}`);
process.on('SIGTERM', () => void server.close().then(() => process.exit(0)));
