import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prints the entry to add to the Claude desktop app's claude_desktop_config.json
 * (Settings → Developer → Edit Config), with this machine's paths filled in.
 */
const here = dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const entry = resolve(here, 'index.ts');

const config = {
  mcpServers: {
    chess: {
      command: process.execPath,
      args: [tsx, entry],
      ...(process.env.DATABASE_PATH ? { env: { DATABASE_PATH: process.env.DATABASE_PATH } } : {}),
    },
  },
};

console.log(`Add this to claude_desktop_config.json (merge it with any "mcpServers" already there), then restart the Claude desktop app:\n`);
console.log(JSON.stringify(config, null, 2));
