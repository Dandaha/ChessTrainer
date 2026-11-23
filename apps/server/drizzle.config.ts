import { defineConfig } from 'drizzle-kit';

// Used by `pnpm db:generate` to write a new migration after a schema change.
// Migrations are applied by `pnpm db:migrate` and on every server start.
export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.ts',
  out: './db/migrations',
});
