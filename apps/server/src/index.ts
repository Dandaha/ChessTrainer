import { backupFolderFor, backupIfDue } from '../db/backup.ts';
import { databasePath, openDatabase, runMigrations } from '../db/client.ts';
import { purgeTrash } from '../db/library.ts';
import { buildApp } from './app.ts';
import { deriveMissingInBackground } from '../db/games.ts';
import { loadEnv } from './env.ts';

loadEnv();

// Local only: the server owns the database, Stockfish and the API key, and is
// never reachable from another machine.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3001;

const { db, close } = openDatabase();
const backupFolder = backupFolderFor(databasePath());
runMigrations(db, { backupFolder });
backupIfDue(db, backupFolder);
purgeTrash(db);

const app = buildApp(db);
app.addHook('onClose', async () => close());

try {
  await app.listen({ host: HOST, port: PORT });
  console.log(`Chess server on http://${HOST}:${PORT} · database ${databasePath()}`);
  // Games from an older version get their opening and content key, a batch at a time.
  void deriveMissingInBackground(db);
} catch (error) {
  console.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
