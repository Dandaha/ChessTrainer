import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Loads apps/server/.env when it exists. Values already in the environment win. */
export function loadEnv(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
