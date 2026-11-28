# Audit, 28 November 2026

Six agents each used one part of the built app (version 0.1.6, commit af43f80) the way a user would, driving it with Playwright and comparing it with Lichess, ChessBase, SCID, Chessable and ChessTempo and with general software standards. A seventh pass reviewed the engineering. Every finding below was reproduced in the running app or traced to the code.

Not tested: a real Claude key, a Lichess token, the Windows window and installer themselves, a screen reader, and spaced repetition over several days.

Work through it top to bottom; delete a line when it is fixed.

## Critical

All ten fixed on 28 November 2026 (coach stream, local-API lock-down, secrets kept from child processes, drawings kept on click, impossible positions refused plus an error boundary, set-up-position repertoire lines, Site-URL duplicates, hidden bulk delete, unsaved-work prompt with undo keeping the library link, CI typecheck and a pinned Stockfish). What remains of the last one is under *Data and engineering*.

## Bugs

All fixed on 28 November 2026:
- the engine panel (clicked lines, few legal moves, repetitions, the 2-minute cut, races, binaries that exit at once);
- the board's keys and buttons;
- print, present mode and set order;
- the training queue;
- the repertoire's PGN round trip, its sides, renaming and deleting;
- broken and Latin-1 PGN files;
- dialogs, the concept picker, `compare_moves`, concept titles, the theme button, the offline notice and Markdown.

## Data and engineering

All fixed on 28 November 2026:
- The game index keeps a 64-bit hash per position instead of a row of text: 10 KB a game instead of 29 (about 1 GB at 100,000 games), with existing libraries moved over and compacted on update.
- Imports run about 40% faster (5 ms a game) and the dialog counts the games as they download and import. Most of what is left is chess.js replaying each move; a faster move generator would need a new dependency.
- The training queue and statistics build only the cards they show: 0.12 s instead of 7 s on a 5,000-move repertoire. The repertoire tree no longer replays every move (1.2 s down to 24 ms).
- Games from a set-up position are written with `SetUp "1"`; NAGs outside 1–255 are dropped.
- The installer's database driver comes from a committed lockfile.

## Missing compared with standard chess software

- **Board:**
  - Engine settings: lines, depth, strength. Threat mode and a key to play the best move.
  - A FEN field and copy FEN, a board editor, and a header-tag editor.
  - Promotion on the target square, castling by dragging the king onto the rook, and Chess960/null moves.
- **Games:**
  - Time-control and speed filters.
  - Duplicate detection by content, and ECO classification of untagged games.
  - "Since last import", and the full list behind "Reached in N games".
  - Positions inside variations indexed.
  - Editing a game's tags, notes and "my colour".
  - A keyboard-usable list; restore all / empty trash / undo.
- **Training:**
  - Multi-move solutions, and drilling a whole line.
  - Opponent moves by priority, and "nice to know" respected.
  - Streaks, a session summary, and solving a set on demand.
- **Repertoire:** confirm or undo a subtree delete; NAGs shown and editable; a move box; expand and collapse all.
- **General:**
  - Confirm or undo for destructive actions.
  - Validation and "Saved" feedback in Settings.
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
