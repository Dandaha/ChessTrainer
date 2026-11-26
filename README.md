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
| `apps/web` | React app: the board (chessground), library screens, sets, present and print modes. |

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

## The library (phase 2)

- **Games**: import PGN files or pasted PGN, or your games from Lichess and Chess.com by
  username (re-importing only adds new games). Filter by player, opening or ECO, result,
  date, tag and your colour; group games into collections. Click a game to open it on the
  board; **Ctrl+S** saves edits back into it.
- **Position search**: the board's **Games** tab lists every library game that reached the
  position on the board (by any move order) and what was played from it.
- **Saved positions**: press **S** on the board. Only a title is required; the source game,
  move and side to move fill in. The same position can be saved several times, each with
  its own idea. Notes are markdown: a FEN line becomes a board and moves like `1. e4 e5`
  become links that open the line.
- **Sets**: ordered groups of saved positions, with **Present** (full screen, reveal the
  idea when you choose), a printable **worksheet** (save it as PDF from the print dialog),
  and PGN export. Single positions export as PNG or PGN.
- **Ctrl+K** jumps to any screen, game or saved position. Deleted items stay in
  Settings → Trash for 30 days.

## Repertoire (phase 3)

- Separate repertoires for White and Black (several per colour if you like). The repertoire
  is a graph of moves between positions, so transpositions are found automatically: the
  explorer marks them **⇄ transposes** and jumps to where the line continues.
- Build it by playing moves on the repertoire's board, by pressing **R** on the analysis
  board (adds the line from the start to the current move), or by importing a PGN with
  variations. Each move has my-move / expected-reply, main line / sideline, must-know /
  nice-to-know and a comment. Export writes one PGN with variations.
- The analysis board's **Repertoire** tab shows your prepared moves for the position and,
  for the game on the board, where it left your preparation ("You left your preparation on
  move 9 with ...Nd7; your line is ...Bd6").
- **Find gaps** asks the Lichess opening explorer which common replies you have not
  prepared. Lichess requires a personal token for it: create one at
  lichess.org/account/oauth/token (no scopes needed) and add `LICHESS_TOKEN=...` to
  `apps/server/.env`.

## Known gaps

What the app deliberately does not do yet, so nobody "fixes" it by accident:

- PGN null moves (`--`) and Chess960 castling are rejected with a clear error.
- Whitespace inside PGN comments is collapsed to single spaces on import.
- A `}` typed into a comment is written as `)`, since PGN comments cannot contain it.
- A variation that repeats an existing move is merged into it on import.
- When a file holds several games, the board opens the first; the library (phase 2) takes the rest.
- The layout is built for a desktop browser; phones are out of scope for v1.
- Full-text search uses SQL `LIKE`, which is fine for thousands of items; SQLite FTS5 can replace it if it gets slow.
- "Games that reached this position" looks at each game's main line only, not its variations.
