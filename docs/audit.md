# Audit, 28 November 2026

Six agents each used one part of the built app (version 0.1.6, commit af43f80) the way a user would, driving it with Playwright and comparing it with Lichess, ChessBase, SCID, Chessable and ChessTempo and with general software standards. A seventh pass reviewed the engineering. Every finding below was reproduced in the running app or traced to the code.

Not tested: a real Claude key, a Lichess token, the Windows window and installer themselves, a screen reader, and spaced repetition over several days.

Work through it top to bottom; delete a line when it is fixed.

## Critical

All ten fixed on 28 November 2026 (coach stream, local-API lock-down, secrets kept from child processes, drawings kept on click, impossible positions refused plus an error boundary, set-up-position repertoire lines, Site-URL duplicates, hidden bulk delete, unsaved-work prompt with undo keeping the library link, CI typecheck and a pinned Stockfish). What remains of the last one is under *Data and engineering*.

## Bugs

### Board and engine
- Clicking a later move in an engine line plays only the first (`BoardScreen.tsx:316`: stale `current`; use `playLineFrom`).
- The engine panel freezes at depth 1 when there are fewer legal moves than lines (`engine.ts:146` waits for line 3).
- The engine can't see repetitions: it is sent only `position fen` (`engine.ts:176`), so a threefold shows +0.31.
- Live analysis ends after 2 minutes with the panel open (idle timer not touched while streaming); closing the panel while the engine starts leaves it searching; two evaluations at once cut each other short and the shallow result is cached.
- A binary that exits at once takes the full 10 s to fail (`Engine.start` ignores "exit").
- Buttons keep focus, so Space or Enter repeats "Delete from here" or "New".
- Ctrl+S inside the comment box opens the browser's Save Page dialog (`BoardScreen.tsx:92`).
- Replaying a move that already exists marks the game unsaved (`useGame.ts:110`).

### Positions and training
- The worksheet prints only its first page: the app shell scrolls inside a 100%-height box and there is no print stylesheet.
- Present mode cuts the top of the board off in windows narrower than 1024 px (`PresentScreen.tsx:71`).
- The summary counts cards due by end of day, the queue only those due now; a card graded Again is never asked again in the session.
- New saved positions never reach the mixed queue: repertoire cards fill all the new slots (`training.ts:252`).
- Reordering a filtered set scrambles the full order (`PositionsScreen.tsx:90`, `library.ts:352`).
- A move that transposes into the repertoire is marked wrong in training.

### Repertoire
- Export then import loses "nice to know", and the transposition note doubles on every round (`repertoire.ts:128` writes them as comment text).
- An import drops comments placed before a move, the intro comment and arrows (`repertoire.ts:67`).
- "Whose move" can be set to the wrong side, which breaks training (`RepertoireScreen.tsx:455`, `repertoire.ts:180`).
- The board's Repertoire tab reports on every repertoire, including the other colour's.
- Repertoires can't be renamed or deleted in the app (the API exists).

### Games and imports
- A broken header tag produces an extra headless game (`pgn.ts:132`).
- Latin-1 PGN files turn to mojibake (`GamesScreen.tsx:402` always reads UTF-8).

### General
- Keys leak through the Ctrl+K palette to the board (Delete deletes a move behind it); dialogs don't trap focus, lack `aria-modal`, and don't return focus.
- The concept picker's Enter creates a duplicate ("minor") instead of picking "Minority attack"; an alias isn't a match.
- `compare_moves` compares depth 18 with depth 16 and calls the best move a loss.
- A concept can have a blank title.
- Choosing a theme in Settings leaves the sidebar's theme button out of step.
- The offline banner tells the installed app's user to run "pnpm dev" and never clears.
- Markdown: a line block after a board reads from that board; a numbered list followed by bullets merges.

### Data and engineering
- Imports are slow: about 5 ms a game (5,000 games ≈ 35 s), most of it chess.js building a full move object for every move; the app stays usable meanwhile, but the dialog shows no progress.
- The database grows ≈ 40 KB per game, mostly the position index (≈ 3 GB at the spec's 100k games).
- The training queue takes ≈ 2.7 s on a 5,000-move repertoire (details built for every new card before keeping 20).
- A FEN game without `SetUp "1"` is written without it; NAGs above 255 are accepted.
- The installer's database driver is installed with `npm install --no-package-lock`, so its own dependencies float between builds.

## Missing compared with standard chess software

- **Board:**
  - The result when the game ends (mate, stalemate, repetition, 50 moves, material), and setting the Result.
  - Arrow keys into side lines.
  - Engine settings: lines, depth, strength. Threat mode and a key to play the best move.
  - A FEN field and copy FEN, a board editor, and a header-tag editor.
  - Promotion on the target square, castling by dragging the king onto the rook, and Chess960/null moves.
- **Games:**
  - Sortable columns (rating, result, player, ECO), with UTCTime as the tie-break.
  - Time-control and speed filters.
  - Export of a collection, a selection or everything.
  - Duplicate detection by content, and ECO classification of untagged games.
  - "Since last import", and the full list behind "Reached in N games".
  - Positions inside variations indexed.
  - Editing a game's tags, notes and "my colour".
  - A keyboard-usable list; restore all / empty trash / undo.
- **Training:**
  - Retry and "show solution", and multi-move solutions.
  - A learn pass before review, and drilling a whole line.
  - Opponent moves by priority, and "nice to know" respected.
  - Streaks, a session summary, and solving a set on demand.
- **Repertoire:** confirm or undo a subtree delete; NAGs shown and editable; a move box; expand and collapse all.
- **General:**
  - Confirm or undo for destructive actions.
  - Validation and "Saved" feedback in Settings.
  - **A Lichess token field in Settings**, without which Find gaps and the opening explorer can't work in the installed app.
  - Layouts for narrow windows, and input borders at 3:1 contrast.

## What works well

- The PGN round trip on the board is exact, including comments, NAGs, nested variations, arrows, clocks and escaped tags.
- Board legality, en passant, castling and under-promotion work.
- Mate scores and the eval sign are right.
- Stockfish runs below normal priority with cores − 2 threads and stops when the panel closes.
- Position search is indexed and fast (1–66 ms).
- Transpositions are detected and drilled once.
- The one-row repertoire tree stays fast at 1,456 moves.
- The coach without a key shows exactly the agreed message.
- The MCP server exposes chess tools only.
- Markdown is safe.
- Static files can't be escaped.
- The Electron window is sandboxed.
- Migrations apply cleanly.
- UTF-8 names in every script work.
- Back, Forward and reload work.
