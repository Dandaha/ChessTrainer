// Builds the folder the installer is made from (apps/desktop/stage):
//   node scripts/build.mjs            bundle the code and copy the pages and assets
//   node scripts/build.mjs --install  also install the database driver for Electron (on Windows, for the installer)
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const root = resolve(desktop, '..', '..');
const stage = join(desktop, 'stage');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const pkg = readJson(join(desktop, 'package.json'));
const serverPkg = readJson(join(root, 'apps', 'server', 'package.json'));
const electronVersion = pkg.devDependencies.electron;
const version = process.env.APP_VERSION || pkg.version;

const run = (command, cwd = root, env = {}) => execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

console.log('1/4 Building the web pages');
run('pnpm --filter @chess/web build');

console.log('2/4 Bundling the code');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// ESM output, with the CommonJS globals some dependencies expect.
const banner = [
  "import { createRequire as __createRequire } from 'node:module';",
  "import { fileURLToPath as __fileURLToPath } from 'node:url';",
  "import { dirname as __pathDirname } from 'node:path';",
  'const require = __createRequire(import.meta.url);',
  'const __filename = __fileURLToPath(import.meta.url);',
  'const __dirname = __pathDirname(__filename);',
].join('\n');
const entries = { main: 'src/main.ts', mcp: 'src/mcp.ts', ...(process.argv.includes('--smoke') ? { smoke: 'src/smoke.ts' } : {}) };
await build({
  entryPoints: Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, join(desktop, file)])),
  outdir: stage,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['electron', 'better-sqlite3'],
  banner: { js: banner },
  logLevel: 'warning',
  legalComments: 'none',
});

console.log('3/4 Copying the pages, migrations and coach prompt');
cpSync(join(root, 'apps', 'web', 'dist'), join(stage, 'web'), { recursive: true });
cpSync(join(root, 'apps', 'server', 'db', 'migrations'), join(stage, 'migrations'), { recursive: true });
cpSync(join(root, 'apps', 'server', 'coach', 'systemPrompt.md'), join(stage, 'systemPrompt.md'));
writeFileSync(
  join(stage, 'package.json'),
  `${JSON.stringify(
    {
      name: 'chess-workspace',
      productName: 'Chess Workspace',
      version,
      description: 'A personal chess workspace: board, games, positions, repertoire, training, concepts and a coach.',
      author: 'Dandaha',
      license: 'UNLICENSED',
      main: 'main.mjs',
      dependencies: { 'better-sqlite3': serverPkg.dependencies['better-sqlite3'] },
    },
    null,
    2,
  )}\n`,
);

if (process.argv.includes('--install')) {
  console.log(`4/4 Installing the database driver for Electron ${electronVersion}`);
  // From a committed lockfile, so the driver's own dependencies are the same in every build.
  const lock = readJson(join(desktop, 'driver', 'package-lock.json'));
  const locked = lock.packages['node_modules/better-sqlite3']?.version;
  if (locked !== serverPkg.dependencies['better-sqlite3']) {
    throw new Error(
      `apps/desktop/driver/package-lock.json has better-sqlite3 ${locked}, the server uses ${serverPkg.dependencies['better-sqlite3']}: update the version in apps/desktop/driver/package.json and run npm install --package-lock-only there.`,
    );
  }
  cpSync(join(desktop, 'driver', 'package-lock.json'), join(stage, 'package-lock.json'));
  run('npm ci --omit=dev --no-audit --no-fund', stage, {
    npm_config_runtime: 'electron',
    npm_config_target: electronVersion,
    npm_config_disturl: 'https://electronjs.org/headers',
  });
  // Ask for Electron's build of the driver by name rather than trusting npm to pass the settings above
  // through; the log shows the file it downloaded (electron-v<ABI>-win32-x64).
  run(
    `node ${JSON.stringify(join(stage, 'node_modules', 'prebuild-install', 'bin.js'))} --runtime=electron --target=${electronVersion} --arch=${process.arch} --verbose`,
    join(stage, 'node_modules', 'better-sqlite3'),
  );
  // Packaging then sees the folder exactly as before the lockfile was used.
  rmSync(join(stage, 'package-lock.json'));
} else {
  console.log('4/4 Skipped installing the database driver (pass --install for the installer)');
}
console.log(`Done: ${stage}`);
