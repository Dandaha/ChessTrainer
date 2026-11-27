# Chess Workspace

Personal chess app: analysis board, game library, saved positions and
position sets, concepts wiki, repertoire builder + trainer, Stockfish,
AI coach. Full spec: docs/SPEC.md. Build ONE phase at a time, in order.
At the end of each phase: run tests, show me how to try it, and stop.

## Stack
- Monorepo with pnpm workspaces:
  - apps/web: React + TypeScript + Vite, Tailwind, chessground, chess.js
    (chessground is published as @lichess-org/chessground; the unscoped
    `chessground` package on npm is deprecated)
  - apps/server: Node + TypeScript + Fastify, Drizzle ORM on SQLite
    (better-sqlite3), listens on 127.0.0.1 only
  - packages/chess-core: position key, PGN parsing, repertoire graph logic
    (pure TS, no UI, fully unit-tested)
  - packages/chess-tools: Stockfish wrapper (UCI over child process) +
    position_facts; used by the server's coach AND by the MCP server
  - apps/mcp: MCP server exposing chess-tools (phase 5)
  - apps/desktop: Electron wrapper; the installed app runs the server and
    the built pages on 127.0.0.1 and bundles Stockfish. The Windows
    installer is built by .github/workflows/desktop.yml on every push.
- Stockfish: native binary from stockfishchess.org, path set in Settings.
  Run it at below-normal priority, threads = cores - 2, hash 256 MB,
  stop it when the analysis panel is closed.
- Developed on Windows. Use cross-platform paths and scripts.
- Also approved (Nov 2026): drizzle-kit, tsx, @testing-library/react, jsdom,
  ts-fsrs, zod, @anthropic-ai/sdk, @modelcontextprotocol/sdk, @types/*, the
  Vite/Tailwind plugins, electron, electron-builder and esbuild.

## Data rules
- The position key is FEN fields 1-4, with en passant kept only if a
  capture is legal. All lookups go through
  packages/chess-core/positionKey.ts, which has unit tests.
- Repertoire = a graph of edges between positions (repertoire_moves),
  never a duplicated tree.
- Several saved_positions may point at the same position. Training is
  opt-in per save (in_training, default false).
- Position sets are named, ordered groups of saved positions (for
  teaching, showing friends, or myself). A save can be in many sets.
- All ids are UUIDs. Portable types only (ISO timestamps, booleans, JSON
  only where needed) so the DB can move to Supabase/Postgres later.
- All DB access lives in apps/server/db/. Nothing else writes SQL.
- Schema changes are Drizzle migrations. Never edit an old migration.
- Everything round-trips through PGN: import -> edit -> export loses nothing.

## Security and AI
- .env is in .gitignore from the first commit. The Claude API key lives
  only in apps/server/.env (run from source) or in the app's data folder
  (installed app), and never reaches the browser.
- The coach is OFF unless an API key is set. Without a key the coach panel
  shows "Coach not connected - add an API key in Settings" and nothing
  else breaks.
- The coach must not state an eval or tactic without a tool result. Keep
  this rule in apps/server/coach/systemPrompt.md.
- Log input/output tokens of every coach call in coach_messages.
- The MCP server only touches the chess DB and Stockfish: no general file
  or shell access.

## Quality
- Tests (Vitest) for chess-core and chess-tools; UI tests only for
  critical flows (PGN import/export, save position, repertoire add move).
- Keyboard-first UI. Dark and light themes.
- Ask me before adding a dependency that is not listed above.

## Commands
- pnpm dev        # web + server
- pnpm test
- pnpm db:migrate
