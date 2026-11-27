// Run by the packaged app itself in Node mode (ELECTRON_RUN_AS_NODE=1), in CI before publishing:
// proves the database driver loads in this Electron, which is what failed on a real install.
const { join, resolve } = require('node:path');

const appDir = resolve(process.argv[2]);
const Database = require(join(appDir, 'node_modules', 'better-sqlite3'));
const db = new Database(':memory:');
const { version } = db.prepare('select sqlite_version() as version').get();
db.close();
console.log(`better-sqlite3 loads in Electron ${process.versions.electron} (ABI ${process.versions.modules}), SQLite ${version}`);
