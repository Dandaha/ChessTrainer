import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server/.env: the only place secrets such as the Claude API key live. */
export function envFilePath(): string {
  return process.env.CHESS_ENV_FILE || resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
}

/** Loads apps/server/.env when it exists. Values already in the environment win. */
export function loadEnv(): void {
  const file = envFilePath();
  if (existsSync(file)) process.loadEnvFile(file);
}

/**
 * Sets (or with null, removes) one variable in apps/server/.env, keeping the
 * other lines, and in this process. The file is made readable by its owner only.
 */
export function writeEnvValue(name: string, value: string | null): void {
  const file = envFilePath();
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const kept = lines.filter((line) => !new RegExp(`^\\s*${name}\\s*=`).test(line));
  while (kept.length && kept.at(-1) === '') kept.pop();
  if (value !== null) kept.push(`${name}=${value}`);
  writeFileSync(file, `${kept.join('\n')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows ignores Unix permissions; the file stays in the user's own folder.
  }
  if (value === null) delete process.env[name];
  else process.env[name] = value;
}
