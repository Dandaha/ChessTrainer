import { databasePath, openDatabase, runMigrations } from './client.ts';
import { loadEnv } from '../src/env.ts';

// `pnpm db:migrate`: bring the database file up to the latest schema.
loadEnv();
const path = databasePath();
const { db, close } = openDatabase(path);
runMigrations(db);
close();
console.log(`Database is up to date: ${path}`);
