# Chess Workspace

A personal chess workspace: analysis board, game library, saved positions,
concepts wiki, repertoire builder and trainer, Stockfish, and an AI coach.
The full spec is in [docs/SPEC.md](docs/SPEC.md); working rules for Claude
Code are in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node 22.12 or newer
- pnpm 10 (`npm install -g pnpm`)

## Commands

```bash
pnpm install
pnpm dev          # web on http://127.0.0.1:5173, API server on 127.0.0.1:3001
pnpm test         # every package's tests
pnpm typecheck
pnpm db:migrate   # bring the database up to date (the server also does this on start)
pnpm db:generate  # write a new migration after changing apps/server/db/schema.ts
```

The database is one file, `apps/server/data/chess.db` by default. Copy
`apps/server/.env.example` to `apps/server/.env` to change the port or the
database path.

## Layout

| Path | What it is |
| --- | --- |
| `packages/chess-core` | Position key, move tree, PGN reading and writing, board helpers. Pure TypeScript, no UI. |
| `apps/server` | Fastify API on 127.0.0.1. All SQL lives in `apps/server/db/`. |
| `apps/web` | React app: the analysis board (chessground), move list, annotations. |

## The analysis board

- Paste a PGN or FEN anywhere (Ctrl+V), or press **O** to open one.
- Move by dragging, or press **/** and type a move (`Nf3`, `nf3` and `g1f3` all work).
- ← → step through moves, ↑ ↓ jump to the start or the end of the line, **F** flips.
- Right-click drag draws an arrow, right-click a square circles it (Shift red, Alt blue).
  Drawings are saved in the PGN as `[%cal]` / `[%csl]`.
- Right-click a move to promote it, make it the main line or delete from it.
  **Delete** deletes from the current move; **Ctrl+Z** undoes.
- **X** exports the PGN; **?** lists every shortcut.
- The game on the board is kept in the browser across reloads. Saving games to
  the library comes in phase 2.

## Known gaps

What the app deliberately does not do yet, so nobody "fixes" it by accident:

- PGN null moves (`--`) and Chess960 castling are rejected with a clear error.
- Whitespace inside PGN comments is collapsed to single spaces on import.
- A `}` typed into a comment is written as `)`, since PGN comments cannot contain it.
- A variation that repeats an existing move is merged into it on import.
- When a file holds several games, the board opens the first; the library (phase 2) takes the rest.
- The layout is built for a desktop browser; phones are out of scope for v1.
