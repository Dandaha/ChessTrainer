# Audit, 28 November 2026

Six agents each used one part of the built app (version 0.1.6, commit af43f80) the way a user would, driving it with Playwright and comparing it with Lichess, ChessBase, SCID, Chessable and ChessTempo and with general software standards. A seventh pass reviewed the engineering. Every finding below was reproduced in the running app or traced to the code; the three marked ✔ were rechecked by hand.

Not tested: a real Claude key, a Lichess token, the Windows window and installer themselves, a screen reader, and spaced repetition over several days.

Work through it top to bottom; delete a line when it is fixed.

## Critical

1. ✔ **Coach answers never reach the screen.** `routes/coach.ts:30` listens for `req.raw` "close", which Node fires as soon as the request body is read, so every event after that is dropped: the panel says "Thinking…" forever while the answer is saved and billed. The tests miss it because `app.inject` opens no socket. Listen on `reply.raw`, abort the model call when the client leaves, and add a real-socket test.
2. **Any website can make the app run a program (DNS rebinding).** No route checks the Host or Origin header; a rebound page can `PUT /api/settings` an `enginePath` and then `GET /api/engine/status` runs it. Accept only `127.0.0.1:<port>`/`localhost`, reject foreign origins, and set the engine path only from a file picker.
3. ✔ **The Claude API key is handed to Stockfish and to the MCP server.** `engine.ts:66` spawns with the whole environment, which holds `ANTHROPIC_API_KEY`; the MCP config passes `CHESS_ENV_FILE`. Spawn with an environment without the key; drop the env file from the MCP config.
4. ✔ **Clicking a piece erases saved arrows and circles.** Chessground's `drawable.eraseOnMovablePieceClick` defaults to true (`Board.tsx:87`); the `[%cal]`/`[%csl]` are lost from the PGN with no undo.
5. **An illegal FEN blanks the whole app.** A position where the side not to move is in check is accepted; capturing the king throws and there is no error boundary. Reject such FENs (`positionKey.ts`) and add an error boundary.
6. **Repertoire moves from a set-up position are invisible, never trained, and deleted silently** with an unrelated move (`repertoireTree`, `linesTo`, `deleteMove` → `unreachableEdges` all start from the initial position).
7. **Different games that share a Site URL are dropped as duplicates** (`games.ts:104`: any http Site is used as the game's id).
8. **Bulk delete removes games you can't see**: the selection survives a filter change, and Delete trashes it without asking (`GamesScreen.tsx:65`).
9. **Unsaved board work is replaced without asking** when opening another game, New, Open or paste; undo after New loses the library link, so Ctrl+S then saves a duplicate (`workspace.tsx:113-166`, `useGame.ts:163`).
10. **Every push to main installs itself on the next close**, gated only by `pnpm test`: no typecheck in CI, Stockfish downloaded unpinned, `npm install --no-package-lock`. Add typecheck and the real-socket coach test to CI, pin Stockfish by tag and SHA-256.

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
- A second winning move is marked wrong, and "2. ... Qh4#" in an answer is misread (`TrainingScreen.tsx:280`, `routes/engine.ts:69`).
- The answer is prefilled with the game's next move, often the blunder itself (`BoardScreen.tsx:408`).
- The worksheet prints only its first page: the app shell scrolls inside a 100%-height box and there is no print stylesheet.
- Present mode cuts the top of the board off in windows narrower than 1024 px (`PresentScreen.tsx:71`).
- A second move during "Checking with Stockfish…" is played and sent, and the server answers 500.
- The summary counts cards due by end of day, the queue only those due now; a card graded Again is never asked again in the session.
- New saved positions never reach the mixed queue: repertoire cards fill all the new slots (`training.ts:252`).
- The daily limit of new cards leaks: only `reps = 1` counts as new today (`training.ts:118`). Found by three agents.
- Reordering a filtered set scrambles the full order (`PositionsScreen.tsx:90`, `library.ts:352`).
- The stats chart is a day off east of UTC (Israel): days are cut at local midnight but grouped by UTC date (`training.ts:283`).
- A move that transposes into the repertoire is marked wrong in training.
- "Gives away the win" is said for a move that is still winning; judge by win percentage, as Lichess does.

### Repertoire
- Export then import loses "nice to know", and the transposition note doubles on every round (`repertoire.ts:128` writes them as comment text).
- A bad import fails silently ("Added 0 moves from 0 games"; the errors are never shown), and comments before a move, the intro comment and arrows are dropped (`repertoire.ts:67`).
- "Whose move" can be set to the wrong side, which breaks training (`RepertoireScreen.tsx:455`, `repertoire.ts:180`).
- The board's Repertoire tab reports on every repertoire, including the other colour's.
- Repertoires can't be renamed or deleted in the app (the API exists).

### Games and imports
- Searching for a name with `_` or `%` finds nothing: the LIKE has no `ESCAPE` clause (`games.ts:271`, `library.ts:26`, `concepts.ts:44`).
- Case-insensitive search works only for ASCII (Каспаров, MÜLLER).
- Lichess imports bring in variant games; a three-check game imports as standard chess (`importers.ts:40`).
- Importing another player's games makes them your username and your colour (`routes/library.ts:104`).
- A broken header tag produces an extra headless game (`pgn.ts:132`).
- Latin-1 PGN files turn to mojibake (`GamesScreen.tsx:402` always reads UTF-8).

### General
- Keys leak through the Ctrl+K palette to the board (Delete deletes a move behind it); dialogs don't trap focus, lack `aria-modal`, and don't return focus.
- The concept picker's Enter creates a duplicate ("minor") instead of picking "Minority attack"; an alias isn't a match.
- "Save and test" saves a broken engine path before testing it, and the MCP server then ignores its own Stockfish.
- The MCP server accepts illegal positions; `compare_moves` compares depth 18 with depth 16 and calls the best move a loss.
- A concept can have a blank title.
- Choosing a theme in Settings leaves the sidebar's theme button out of step.
- The offline banner tells the installed app's user to run "pnpm dev" and never clears.
- Markdown: a line block after a board reads from that board; a numbered list followed by bullets merges.

### Data and engineering
- No input validation: a `PUT` writes any field it is given (a new FEN leaves `position_id` stale; `sideToSolve: "purple"` is stored); a malformed body is a 500, not a 400. zod is installed.
- Updates that touch several tables are not one transaction (a bad set id half-applies an update).
- The 30-day purge leaves orphan concept links and training cards.
- Large imports freeze the server: one synchronous transaction, 3,000 games ≈ 30 s with every request waiting; parsing builds a new Chess object per move (`tree.ts:142`).
- The database grows ≈ 40 KB per game, mostly the position index (≈ 3 GB at the spec's 100k games).
- The training queue takes ≈ 2.7 s on a 5,000-move repertoire (details built for every new card before keeping 20).
- No backup, and copying `chess.db` alone while the app runs misses the WAL.
- Server errors leave no log in the installed app.
- A FEN game without `SetUp "1"` is written without it; NAGs above 255 are accepted.

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
