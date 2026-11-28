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

Built on 28 November 2026:
- **Board:** engine settings (lines, depth, strength), threat mode (T) and Space for the best move; a FEN field, a board editor and a tag editor; promotion on the target square and castling by putting the king on its rook.
- **Games:** time-control and speed filters; duplicates found by content; openings filled in from Lichess's open table; the last import; the full list behind "Reached in N games"; editing tags, notes and colour from the library; a keyboard-usable list; Restore all and Empty trash.
- **Training:** solutions of several moves; line drills from the first move; replies weighted by main line and priority; nice-to-know moves introduced last and scheduled less often.
- **Repertoire:** confirmation before a subtree delete; NAGs shown and editable; a move box; Expand all and Collapse all.
- **General:** Undo for every delete that goes to the trash, confirmation for the rest; Settings checked, with "Saved"; layouts down to the 960-pixel window, and field edges at 3:1 contrast.

Still open (not chosen for now):
- Chess960 and null moves.
- Positions inside variations indexed (only the main line is).
- Training streaks and a summary at the end of a training session. (Solving a set on demand was built on 28 November 2026.)
- Sub-concepts: a concept that belongs under another (absolute and relative pin under Pin, the kinds of opposition under Opposition). For now they are aliases or related concepts; to decide: a parent concept, shown as a tree, or the flat list with better related links.

## Final check, 28 November 2026

Four testers used the built app (as the installer runs it) area by area, and an old library (version 0.1.6) was opened with the new version: 402 games, a repertoire, training history and concepts all came through, the position index went from 27,702 rows to 15 and the file from 14.7 MB to 4.3 MB. What they found was fixed the same day, including the five small things first left open:
- Undoing "Remove from collection" puts the games back where they were in the collection.
- A set shown through a filter numbers its cards by their places in the whole set.
- A set or collection name already in use (ignoring case and accents) is refused in the name box, which stays open for another name.
- The games screen keeps its collection, filters, sort and page while the app is open.
- At a drawn game end the engine panel shows 0.00 with the reason, and the engine's lines under "If the game goes on".

## QA and design review, 28 November 2026

Five testers went through every screen of the built app with large and odd libraries (19,000 games, a 1,593-move repertoire, long, Hebrew and emoji names, windows from 960 to 1440 pixels, both themes), and a designer reviewed the look. About 140 findings came back; all the bugs and most of the design points were fixed the same day. Two decisions taken along the way:
- "Find duplicates" keeps the copy with the most of your own work in it (notes, tags, your colour, collections), then the one with the most comments, then the oldest.
- "Last import" is the games that import brought in or back, by an id stored on each game (migration 0012).

Design points left for later, each a larger change to a screen's layout:
- Board: the move buttons under the move list, the FEN row folded away, and the side panel as tall as the board, so the board can grow (about 740 pixels at 1440×900); player strips with names, ratings and material beside the board; the engine as a compact block above the notes instead of a tab.
- Repertoire: the board on the left as on the Board screen, with the engine block, the tree and a folding move editor on the right; the toolbar as a repertoire switcher, Train, Drill line and Find gaps, the rest in a "⋯" menu.
- Games: Player, Opening, Time control, Dates and Tag in a "Filters" popover, with the active filters as removable chips.
- A mark on the first move of a game that leaves the repertoire, in the move list and beside the opening name.
- The command palette with actions (Import games, New position, Start training, Flip, Theme) and recent items; "?" on every screen.
- Concepts: a landing page of category tiles and recently viewed concepts; "Link a position" and "Find in my games" on a concept page.
- A two-column move list for games without comments.
- Settings: a status per section (engine, token, coach) and Copy / Open folder beside the paths.

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
