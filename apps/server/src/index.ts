import { databasePath, openDatabase, runMigrations } from '../db/client.ts';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

loadEnv();

// Local only: the server owns the database, Stockfish and the API key, and is
// never reachable from another machine.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3001;

const { db, close } = openDatabase();
runMigrations(db);

const app = buildApp(db);
app.addHook('onClose', async () => close());

try {
  await app.listen({ host: HOST, port: PORT });
  console.log(`Chess server on http://${HOST}:${PORT} · database ${databasePath()}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
