# Chess Workspace

A personal chess workspace: analysis board, game library, saved positions,
concepts wiki, repertoire builder and trainer, Stockfish, and an AI coach.
The full spec is in [docs/SPEC.md](docs/SPEC.md); working rules for Claude
Code are in [CLAUDE.md](CLAUDE.md).

## Install the app (Windows)

Download the installer of the release marked **Latest** on this repository's
**Releases** page (`Chess-Workspace-Setup-<version>.exe`) and run it: that is the
stable version. Windows may warn that the publisher is unknown, since the
installer is not code-signed: in the browser choose **Keep**, and in "Windows
protected your PC" choose **More info → Run anyway**. Stockfish comes with the
app; your data stays in `%APPDATA%\Chess Workspace` (Settings → Your data), also
across updates.

Two kinds of release are published:
- **Test versions**: every push to `main` builds one, marked *Pre-release*. An
  installed app takes them only with **Settings → Updates → Test versions**
  switched on (for trying changes out).
- **Stable versions**: published by running the *Windows installer* workflow by
  hand (Actions → Windows installer → Run workflow, with *stable* ticked). Every
  installed app takes them; a student's copy takes nothing else.

The installed app updates itself: it checks when it opens and every six hours,
downloads a new version in the background and offers to restart into it
(otherwise it installs when the app is closed). **Settings → Updates** shows the
version running and where updates stand: checking, downloading (with how far),
ready to restart into, or why a check failed; it can also check now. Update
problems never interrupt; the details go to `updates.log` in the data folder. This needs the
repository to be public, since the app reads the releases without a token.

## Run from source (development)

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
pnpm mcp:config   # print the Claude desktop app entry for the MCP server
```

The database is one file, `apps/server/data/chess.db` by default. Copy
`apps/server/.env.example` to `apps/server/.env` to change the port or the
database path.

## Layout

| Path | What it is |
| --- | --- |
| `packages/chess-core` | Position key, move tree, PGN reading and writing, repertoire graph logic, board helpers. Pure TypeScript, no UI. |
| `packages/chess-tools` | Stockfish over UCI (`engine.ts`, Node only), engine scores (`score.ts`, browser-safe), position facts and the coach's tools. |
| `apps/server` | Fastify API on 127.0.0.1. All SQL lives in `apps/server/db/`. |
| `apps/web` | React app: the board (chessground), library screens, sets, present and print modes. |
| `apps/mcp` | MCP server exposing chess-tools to the Claude desktop app. |
| `apps/desktop` | Electron wrapper and installer build (`electron-builder.yml`, `scripts/build.mjs`). |

## The analysis board

- Paste a PGN or FEN anywhere (Ctrl+V), or press **O** to open one.
- Move by dragging, or press **/** and type a move (`Nf3`, `nf3` and `g1f3` all work).
- ← → step through moves, ↑ ↓ jump to the start or the end of the line, **F** flips.
- Strips above and below the board show the material difference, as on Lichess: the pieces
  a side has taken more of than it lost (a trade cancels out) and its lead in points
  (Q 9, R 5, B 3, N 3, P 1). Each side's strip is at its own edge of the board.
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
- **New position** on the Positions screen sets one up by hand: pieces, whose move,
  castling and en passant (or a pasted FEN; the move number and the 50-move count are
  under Advanced, folded away), then its
  title, category, tags, notes, key idea, answer, set and training in one go. Repetitions
  before the position are not kept: they belong to a game, not a position, so a position
  where they matter is best saved from its game.
- **Sets**: ordered groups of saved positions, with **Present** (full screen, reveal the
  idea when you choose), **Solve** (the positions one by one as puzzles, checked as in
  training but as practice only, then a summary with the missed ones to try again), a
  printable **worksheet** (save it as PDF from the print dialog), and PGN export. Single
  positions export as PNG or PGN.
- **Ctrl+K** jumps to any screen, game or saved position. Deleted items stay in
  Settings → Trash for 30 days.

## Repertoire (phase 3)

- Separate repertoires for White and Black (several per colour if you like). The repertoire
  is a graph of moves between positions, so transpositions are found automatically: the
  explorer marks them **⇄ transposes** and jumps to where the line continues.
- Build it by playing moves on the repertoire's board, by pressing **R** on the analysis
  board (adds the line from the start to the current move), or by importing a PGN with
  variations. Each move is mine or an expected reply, must-know or nice-to-know, with a
  comment. A move of mine is the main one (what I play) or a side move (an alternative I
  know); the opponent's replies are all prepared alike, and **Move to top** only sets which
  is listed first, which the PGN export writes as the main line. Drills bring must-know
  replies up three times as often as nice-to-know ones.
- Switches above the repertoire's board: **Engine lines** (**E**: Stockfish's lines, with
  the eval bar, depth, strength and threat mode **T**), **Best-move arrow** (**A**, purple)
  and **Variation arrows** (**V**, the prepared moves). **Space** adds the engine's best
  move to the repertoire, and a click on a move in an engine line adds the line up to it.
- The mouse wheel over a board steps through the moves, on the analysis board and the
  repertoire's.
- **Opening names** come from Lichess's table (all of ECO A00–E99 with its named variations,
  CC0), by position, so a transposition is named too: the move on the analysis board, the
  selected repertoire move (and each move's tooltip in the tree), and a saved position (from
  its game's moves, or its own position if that is a named one). The name is the deepest named
  position along the line, so a move past the book keeps its opening's name.
- The analysis board's **Repertoire** tab shows your prepared moves for the position and,
  for the game on the board, where it left your preparation ("You left your preparation on
  move 9 with ...Nd7; your line is ...Bd6").
- **Find gaps** asks the Lichess opening explorer which common replies you have not
  prepared. Lichess requires a personal token for it: create one at
  lichess.org/account/oauth/token (no scopes needed) and add `LICHESS_TOKEN=...` to
  `apps/server/.env`.

## Engine and training (phase 4)

- **Stockfish**: download it from stockfishchess.org and paste the path to the program in
  Settings → Engine (then *Save and test*). On the board, **E** turns the engine panel on:
  an eval bar, the three best lines (click a move to play the line) and the best move as an
  arrow. Stockfish runs at below-normal priority with all cores but two and 256 MB of hash,
  stops searching as soon as the panel is off, and the process quits after two idle
  minutes. Results are kept in `engine_cache`, so a position is never analysed twice.
- **Training** uses FSRS spaced repetition. Every main-line move of yours in a repertoire is
  a card: the app plays the line up to it and you find your move (a sideline of yours counts
  as *Hard*). Saved positions join when you tick *In training*: you play the move and it is
  checked against your written answer and against Stockfish (within half a pawn of the best
  move counts). Grade with **1–4** or **Enter**. New cards are introduced 20 a day.
- **Home** shows today's queue ("3 repertoire cards and 2 positions due today, plus 8 new");
  the Training screen also shows reviews per day, accuracy per repertoire and the weakest
  lines.

## Concepts and the coach's tools (phase 5)

- **Concepts** is your chess wiki: one page per concept with aliases (search finds it under
  any name), a category, tags, *key signs* and a markdown text where a FEN on its own line
  becomes a board and moves become links (moves after a board are read from that board).
  Pages link both ways to saved positions, positions, games, repertoire moves and related
  concepts. Create one on the spot from the save box by typing its name. **Drill** shows a
  random linked position and reveals the page once you have played your move.
- It starts filled: 120 classic concepts from forks to the Lucena position (tactical motifs,
  checkmate patterns, practical play, opening ideas, pawn structures, strategic plans,
  endgame technique), each with key signs, a write-up, related concepts and a level tag
  (#basic, #intermediate, #advanced); famous lines show as boards. They are added once to
  every library, never over a concept of the same name, and **Add missing starter concepts**
  brings back any deleted. Categories are your own, as for positions: add, rename or remove
  them on the Concepts screen, or pick "New category…" when editing a concept.
- **packages/chess-tools** holds the coach's tools, written once for both coaches:
  `evaluate`, `compare_moves`, `play_line`, `position_facts`, `find_threats`,
  `search_concepts`, `get_repertoire`, `search_games` and `opening_stats`.
- **apps/mcp** exposes them as an MCP server for the Claude desktop app, so you can ask
  about a position with your Claude subscription. It reads the chess database and runs
  Stockfish, nothing else (no file or shell access; the online opening statistics are left
  out). To connect it:

  ```bash
  pnpm mcp:config
  ```

  prints the entry for `claude_desktop_config.json` (Claude desktop app → Settings →
  Developer → Edit Config) with this computer's paths filled in. Restart the Claude app,
  then ask, for example, *"What should White play in r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4?"*

## The in-app coach (phase 6)

- The board's **Coach** tab (**C**) answers questions about the position on the board with
  Claude, using the same chess tools: it checks Stockfish before it states an evaluation
  (the rule lives in `apps/server/coach/systemPrompt.md`), draws its arrows on your board,
  and gives its key lines as buttons that play them.
- Quick buttons: *Explain this move*, *Why not…?*, *What's the plan?*, *Review this game*
  (Stockfish finds the 3–5 biggest drops first, the coach explains them), *Explain this
  opening*, *Tag this position* (suggests concepts and tags; you confirm each one).
- Models: Claude Haiku 5.5 for quick questions; Claude Sonnet 5.5 for plans, openings and
  game reviews (or tick *Think deeper*). Both can be changed in Settings → Coach, Claude Opus
  5.5 included. Sonnet and Opus requests fall back to another model server-side if one
  declines (`fallbacks: "default"`); Haiku has no server-side fallback.
- The coach is off until you add a Claude API key in Settings → Coach. The server writes it
  to `apps/server/.env`; it never reaches the browser. Every answer's tokens are stored in
  `coach_messages`; the panel shows them per answer and Settings shows the month's total with
  an estimated cost. Set a monthly spending limit in the Claude Console.
- The system prompt and tool definitions are sent first and marked for prompt caching, so
  repeated questions mostly read from the cache.

## Known gaps

What the app deliberately does not do yet, so nobody "fixes" it by accident:

- PGN null moves (`--`) and Chess960 castling are rejected with a clear error.
- Whitespace inside PGN comments is collapsed to single spaces on import.
- A `}` typed into a comment is written as `)`, since PGN comments cannot contain it.
- A variation that repeats an existing move is merged into it on import.
- When a file holds several games, the board opens the first; the library (phase 2) takes the rest.
- The layout is built for a desktop browser; phones are out of scope for v1.
- The installer is not code-signed, so Windows shows an "unknown publisher" warning once.
- The desktop app uses Electron 42, the newest line with a ready-made build of the database
  driver; moving to a newer Electron means building that driver from source in CI.
- Stockfish (GPLv3) is bundled for personal use; its licence text ships next to it.
- Full-text search uses SQL `LIKE`, which is fine for thousands of items; SQLite FTS5 can replace it if it gets slow.
- "Games that reached this position" looks at each game's main line only, not its variations.
- The coach was tested with a stand-in for the Claude API (no key in the build environment);
  its first real answers will be the first live test.
- The gap finder and the coach's opening statistics need `LICHESS_TOKEN`; without it they
  say so and everything else works.
