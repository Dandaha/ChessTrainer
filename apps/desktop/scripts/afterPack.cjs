// electron-builder hook, run after the app folder is assembled and before the installer is made.
// The packager collects node_modules from the pnpm workspace, where better-sqlite3 is built for
// Node; the app needs the copy build.mjs --install made for Electron, so it replaces them here.
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');

exports.default = async function afterPack(context) {
  const from = join(__dirname, '..', 'stage', 'node_modules');
  const to = join(context.appOutDir, 'resources', 'app', 'node_modules');
  if (!existsSync(join(from, 'better-sqlite3'))) {
    throw new Error('stage/node_modules has no better-sqlite3: run scripts/build.mjs --install first');
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, dereference: true });
  console.log(`  • node_modules replaced with the Electron build from ${from}`);
};
