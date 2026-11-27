# Chess Program — Product & Technical Spec

Nov 22, 2026 · @David Manhattan

## Vision and scope

A personal chess workspace that holds everything I study in one place (games, positions, concepts, repertoire) and a coach that explains positions by combining Stockfish's calculation with an AI's language.

**Principles**

- **Position is the unit.** Every game, note, concept and repertoire line connects through the positions it contains, so transpositions and "I've seen this before" work automatically.
- **Capture in one keystroke.** Saving a position or adding a repertoire move must take seconds, from any board in the app.
- **The engine is the truth, the AI is the teacher.** The coach never states an evaluation or a tactic it has not checked with Stockfish.
- **Never locked in.** Everything imports and exports as standard PGN/FEN. The database is a single file I can back up.
- **Modern and fast.** Keyboard-first, clean UI, no 2005-era menus.

**In scope (v1):** analysis board, game library, saved positions, concepts library, repertoire builder and trainer, Stockfish analysis, AI coach.

**Out of scope (for now):** playing online, multiplayer, puzzles from external sources, mobile app, selling it to others.

## Feature modules

Seven modules share one board component and one database. Each is listed with its must-have features (v1) and later ideas.

### 1. Analysis board (the center of the app)

- Drag-and-drop board, flip, arrows and square highlights (right-click drag, like Lichess)
- Move list with full variation support: sidelines, comments, NAGs (!, ?, !?, +=), promote/delete variation
- Keyboard navigation: arrows to move through moves, S = save position, R = add to repertoire, E = toggle engine, C = ask coach
- Paste FEN or PGN anywhere to open it
- Context panel that shows, for the current position: repertoire status, saved notes, linked concepts, games that reached it
- Later: board themes, piece sets, sound

### 2. Game library

- Import PGN files or pasted PGN; import my games from Lichess and Chess.com by username
- Collections (e.g. "Selected classics", "My best games", "Carlsen endgames")
- Each game: players, ratings, result, date, event, opening (ECO + name), my color, tags, personal notes
- Annotate a game in the analysis board and save the annotations back into the game's PGN
- Search by player, opening, tag, date, result, and by position ("all games that reached this FEN")
- Later: automatic game review (find my mistakes by eval drops, send the worst 3 to the coach)

### 3. Saved positions

- **Save in one key (S)** from any board: position, side to move, source game, move number, players and event fill in automatically. Only a title is asked for; everything else can be added later.
- **The same position can be saved more than once**, each save with its own title and idea (e.g. one about the tactic, one about the endgame that follows). The save box shows a hint, "You saved this position before (1)", linking to the earlier save.
- **Fields:** title, category (my own list, starting with tactic, strategy, endgame, opening, calculation, defense; add, rename or remove them on the Positions screen), tags, key idea (can be hidden), notes in markdown with clickable lines, linked concepts, source, difficulty.
- **Training is opt-in per save.** An "Add to training" toggle, off by default. Beautiful positions, teaching material and things to show friends simply stay in the collection.
- **Position sets:** named, ordered groups of saved positions for a purpose, e.g. "Lesson: Greek gift sacrifice", "To show Dani", "Most beautiful moves". A position can be in any number of sets.
- **Present mode:** step through a set full-screen, one position at a time, revealing the idea when I choose. For teaching and showing friends.
- **Export:** a set or a single position as PGN (with notes), as board images (PNG), or as a printable worksheet (PDF: boards with space to write, answers on the last page). Later: a share link.
- **Browse:** grid of mini-boards, filters (category, tag, concept, set, source, in training or not), full-text search, smart lists such as "my mistakes from the last 30 days".
- **Solve mode** for positions in training: the key idea stays hidden, I play my move, it is checked against my answer and Stockfish, then spaced repetition schedules the next review.

### 4. Concepts library

- A personal chess wiki: one page per concept (e.g. "Minority attack", "Good knight vs bad bishop", "Lucena position"), with aliases so search finds it under any name
- Categories: pawn structures, strategic plans, tactical motifs, endgame technique, opening ideas, practical play; free tags for anything finer
- Markdown text with embedded interactive mini-boards (paste a FEN or a line, it becomes a board), a "key signs" list of what to look for, and related concepts
- Links both ways: a concept page lists its linked positions, games and repertoire moves; those show the concept in their side panel
- Create a concept on the spot from the save box with just a title, and write it up later
- Concept drill: show a random linked position, I play the idea, then the concept page is revealed
- The coach can search concepts, cite them in explanations, and suggest which ones fit a newly saved position

### 5. Repertoire builder

- Separate repertoires for White and Black (and several per color if I want, e.g. "Main" and "Surprise weapons")
- Build by playing moves on the board; each move is marked as *my move* or *expected opponent move*
- Main line vs sideline per position, comment per move, priority (must-know / nice-to-know)
- Two views: tree explorer (collapsible) and board view ("what do I play here?")
- Transposition badge when a position is reached by another move order
- Gap finder: lists common opponent replies (from the Lichess opening explorer) that my repertoire does not answer yet
- Repertoire check on a game: "you left your preparation on move 9 with ...Nd7; your line is ...Bd6"
- Import/export as PGN with variations

### 6. Training

- Repertoire drill with spaced repetition (FSRS algorithm): the app plays the opponent's moves, I must find mine
- Saved-positions drill in solve mode, also spaced
- Daily queue: "12 repertoire cards and 5 positions due today"
- Stats: accuracy per line, weakest lines

### 7. AI coach

- Chat panel docked next to the board, always aware of the current position and move history
- Quick buttons: *Explain this move*, *Why not...?*, *What's the plan?*, *Review this game*, *Explain this opening*
- Answers can draw arrows and highlights on the board and show lines I can click through
- Full design in the coach section below

## Architecture and tech stack

A local web app: a React front end in Chrome talks to a small server on my PC, which owns the database, Stockfish and the API key. The chess-tools module is written once and used by both the in-app coach and the MCP server.

&#91;embedded content: architecture · one shared chess-tools module, two ways to reach the coach\]

Everything inside the dashed area is my own code and runs offline; only the coach's calls to Claude leave the PC.

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | React + TypeScript + Vite, Tailwind | Same family as what I already use; fast dev server |
| Board and rules | chessground (board), chess.js (move rules, PGN, FEN) | Lichess-quality board with arrows; chess.js is the standard rules library |
| Server | Node + TypeScript + Fastify on localhost | Keeps the API key and Stockfish off the browser; one language everywhere |
| Database | SQLite via Drizzle ORM (better-sqlite3 driver) | One file, no setup, easy backup; fast enough for 100,000+ games |
| Engine | Stockfish native binary over UCI | Several times faster than the browser (WASM) version; WASM stays as a fallback |
| Spaced repetition | ts-fsrs library | Ready-made FSRS algorithm, the same family Anki uses |
| AI | Anthropic TypeScript SDK (tool use), MCP TypeScript SDK | Official libraries for both coach options |
| Tests | Vitest | Fast unit tests for the chess logic |

## Data model

One SQLite database file. The `positions` table is the hub: every other table points at it, which is what links games, notes, concepts and repertoire together.

**The position key.** Each position is stored once, keyed by its FEN with the move counters removed (board + side to move + castling rights + en passant square only if a capture is actually possible). Two move orders that reach the same position get the same key, so transpositions are detected for free.

| Table | Purpose | Key fields |
| --- | --- | --- |
| positions | Every unique position the app has seen | id, fen\_key (unique), full\_fen |
| games | Imported and annotated games | id, pgn, white, black, white\_elo, black\_elo, result, date, event, eco, opening\_name, my\_color, source (file / lichess / chesscom), notes |
| game\_positions | Which positions each game passes through (for position search) | game\_id, ply, position\_id |
| collections / collection\_games | Named game collections | id, name, description / collection\_id, game\_id, order |
| saved\_positions | Positions I chose to keep; several saves may point at the same position | id, position\_id, title, notes\_md, category, key\_idea, side\_to\_solve, difficulty, in\_training (default false), source\_game\_id, source\_ply, created\_at |
| position\_sets / position\_set\_items | Ordered groups of saves for teaching, showing friends or myself | id, name, description / set\_id, saved\_position\_id, order |
| position\_categories | The categories saved positions are filed under; a save holds its category by name | id, name, sort\_order, created\_at |
| concepts | My chess wiki pages | id, title, aliases, category, body\_md, key\_signs, created\_at, updated\_at |
| concept\_links | Concept ↔ position / game / repertoire move / concept | concept\_id, target\_type, target\_id |
| tags / taggings | Free tags on anything | tag\_id, name / tag\_id, target\_type, target\_id |
| repertoires | A named repertoire for one color | id, name, color |
| repertoire\_moves | The repertoire as a graph: an edge from one position to the next | id, repertoire\_id, from\_position\_id, to\_position\_id, san, uci, is\_my\_move, is\_main, priority, comment\_md, nags |
| training\_cards | Spaced-repetition state per item | id, target\_type (repertoire\_move / saved\_position / concept), target\_id, due, stability, difficulty, reps, lapses, last\_review |
| engine\_cache | Stockfish results so nothing is computed twice | position\_id, engine\_version, depth, multipv\_json, created\_at |
| coach\_messages | Coach history per position | id, position\_id, role, content, tool\_trace\_json, input\_tokens, output\_tokens, created\_at |

All ids are UUIDs and all tables are defined through Drizzle with portable types, so the database can move to Supabase (Postgres) later with a migration script rather than a rewrite.

**Why a graph, not a tree, for the repertoire.** A tree repeats a position for every move order that reaches it. Storing edges between positions means a note or a main-line choice made in one place shows up in every line that transposes into it.

## AI coach agent

The coach is a Claude model in a tool-use loop: it gets a question and the position, calls chess tools (Stockfish, a facts extractor, my database) as many times as it needs, then writes the explanation. The code supplies the facts; the model supplies the reasoning and the words.

**How one question runs**

1. I ask "Why is 14.Nd5 good here?" on the board.
2. The app sends Claude: system prompt + tool definitions + a context packet (current FEN, the moves so far, my color, my approximate rating, repertoire info and linked concepts for this position).
3. Claude calls `evaluate` on the position, then `compare_moves` for 14.Nd5 vs the second-best move, then `play_line` on the critical reply.
4. The app runs each tool locally (Stockfish + code) and returns the results.
5. Claude writes the answer plus board annotations (arrows, highlights, clickable lines). Typically 2 to 6 tool calls per question.

**Tools the coach can call**

| Tool | What it returns |
| --- | --- |
| evaluate(fen, multipv=3) | Eval in pawns or mate, best lines (PV) for the top 3 moves, depth |
| compare\_moves(fen, moves\[\]) | Eval of each candidate and the difference, plus the refutation line for the worse ones |
| play\_line(fen, moves\[\]) | The position after the line, eval at the end, and what changed (material, threats) |
| position\_facts(fen) | Computed facts: material balance, hanging and undefended pieces, pins, checks available, pawn structure (isolated, doubled, passed, backward), open and half-open files, king safety, piece mobility |
| find\_threats(fen) | What the side NOT to move would play if it were their turn (the "null move" idea) |
| search\_concepts(query) | Matching pages from my concepts library |
| get\_repertoire(fen) | My prepared move here, sidelines, my comments |
| search\_games(fen) | Games in my library that reached this position, with results |
| opening\_stats(fen) | Lichess explorer move frequencies and win rates (optional, online) |

**Rules in the system prompt**

- Never state an evaluation, a best move or a tactic without a tool result that supports it.
- Translate engine numbers into ideas: say *why* a line wins (the knight lands on d5 and the c7 pawn falls), not just "+1.8".
- When the engine's best move is a deep computer move, say so and also give a practical human alternative if it is within about 0.3 pawns.
- Adjust depth of explanation to my rating, set in Settings.
- Cite my concepts and saved positions by name when they apply.
- Return board annotations in a fixed JSON format the app can draw.

**Coach modes (quick buttons)**

- *Explain this move*: why the move played (or the engine move) is good or bad
- *Why not X?*: compare my candidate with the best move and show the refutation
- *What's the plan?*: strategic summary of the position from facts + engine lines
- *Review this game*: the code finds the 3–5 biggest eval drops; the coach explains each one
- *Explain this opening*: main ideas, typical plans and pawn structures of my repertoire line
- *Tag this position*: suggests concepts and tags for a saved position (I confirm)

**Engine settings.** Stockfish 17 or newer, MultiPV 3, about 1–2 seconds or depth 20 per call for the coach (deeper on request). Every result goes into `engine_cache`, so a repeated question about the same position costs no engine time.

## Running the agent and what it costs

Stockfish is free and runs on my PC. Only the AI part can cost money, and how much depends on where the coach runs. The plan: build the chess tools once as a separate module, then use them in two ways.

| Option | How it works | Cost | Trade-off |
| --- | --- | --- | --- |
| A. In-app coach via the Claude API | The app calls the API with my API key; the coach panel lives inside my app | Pay per token, billed separately from my Claude subscription | Best experience: arrows on my board, one click. Needs an API key with a spending limit |
| B. MCP server | The chess tools are exposed as an MCP server; I ask questions in the Claude desktop app or Claude Code | Covered by my Claude subscription (counts toward plan usage limits), no per-token bill | The coach chats outside my app UI, so no arrows on my board |
| C. Local model (Ollama) | A free open model on my PC calls the same tools | Free | Noticeably weaker explanations; needs a strong GPU |

**Estimated API cost per question** (estimate: about 15,000 input tokens and 1,500 output tokens for a question with 3–4 tool calls; [prices as of today](https://platform.claude.com/docs/en/about-claude/pricing))

| Model | Price in / out (USD per million tokens) | Approx. cost per question | 300 questions a month |
| --- | --- | --- | --- |
| Claude Haiku 5.5 | $0.10 / $0.50 | $0.002 | under $1 |
| Claude Sonnet 5.5 | $2 / $10 | $0.045 | about $14 |
| Claude Opus 5.5 | $4 / $20 | $0.09 | about $27 |

A full game review is about 5 questions, so roughly $0.20 on Sonnet. Prompt caching (the system prompt and tool definitions are the same every call) cuts cached input to 5% of its price, so real costs should land below these numbers.

**Recommendation**

1. While building, use option B: the MCP server lets me test the coach with my subscription at no extra cost.
2. Then add option A inside the app with a model switch: Haiku for quick "explain this move", Sonnet for game reviews and plans.
3. Set a monthly spending limit in the Claude Console (e.g. $10) so there are no surprises.
4. Keep the API key on the local server, never in the browser code.

## Screens and UX

A left sidebar with seven screens. The analysis board can be opened from any of them, with whatever was selected loaded into it.

| Screen | Main content |
| --- | --- |
| Home | Today's training queue, recently opened games and positions, quick "paste PGN/FEN" box |
| Analysis board | Board (center), move list with variations (right), tabs under it: Engine, Coach, Notes, Repertoire, Games-in-this-position |
| Games | Table of games with filters; collections in a side list; click opens the game on the board |
| Positions | Grid of mini-boards with title and tags; filters; solve mode button |
| Concepts | Wiki list by category; page view with text and embedded boards; linked positions underneath |
| Repertoire | Pick a repertoire; tree explorer on the left, board on the right; gaps panel; train button |
| Training | Drill session: board, prompt ("Your move"), feedback, progress for today |
| Settings | Engine path and strength, coach model and spending note, my rating, theme, backup/export |

**UX rules**

- Dark and light themes; the board takes the most space on every screen that has one.
- Every action available from the keyboard; a command palette (Ctrl+K) to jump to any game, position or concept.
- Saving never asks more than a title; everything else is optional and can be added later.
- Undo for deletes (soft delete with a 30-day trash).

## Build phases

Six phases, each usable on its own. The AI comes last on purpose: phases 1–4 already replace the tools I use today.

1. **Foundation.** Project setup, database with migrations, position-key function with tests, analysis board with variations and PGN/FEN import/export.
   - Done when: I can paste a PGN, step through it, add a sideline and export the PGN with the sideline intact.
2. **Games and positions.** Game library, collections, Lichess/Chess.com import, saved positions with tags and notes, position search.
   - Done when: I import 500 of my games, save 10 positions with one key each, and find every game that reached a given position.
3. **Repertoire.** Repertoire graph, tree explorer, my-move/their-move, comments, transposition badges, PGN import/export, repertoire check on a game.
   - Done when: my main White repertoire is in the app, and opening one of my games tells me where I left my preparation.
4. **Engine and training.** Stockfish panel (eval bar, MultiPV), engine cache, FSRS drills for repertoire and positions, daily queue.
   - Done when: I train my repertoire for a week from the daily queue and the due dates behave sensibly.
5. **Concepts and coach tools.** Concepts wiki with embedded boards and links; the chess-tools module (evaluate, compare\_moves, play\_line, position\_facts...) exposed as an MCP server.
   - Done when: from the Claude desktop app I ask about a FEN and get an answer built on real engine calls.
6. **In-app coach.** Coach panel using the Claude API, quick buttons, board annotations, game review, token counter.
   - Done when: "Explain this move" draws arrows on my board and the answer matches what Stockfish says.

## Open decisions

The spec assumes the first option in each row. Changing one later is possible but cheaper to decide now.

| Decision | Assumed | Alternative | Why it matters |
| --- | --- | --- | --- |
| Web or desktop | Local web app (runs on my PC, opened in Chrome) | Desktop app via Tauri; or hosted online | Desktop is nicer to launch; hosted lets me use it from my phone but needs login and a server |
| Where data lives | One local SQLite file | Supabase (cloud) | Local is simpler and private; cloud gives sync between devices |
| Board library | chessground (the Lichess board) | react-chessboard | chessground is smoother and has arrows built in; it is GPL, which only matters if I ever distribute the app |
| UI language | English | Hebrew (right-to-left) or both | Chess notation is English anyway; RTL support is easier to add at the start than later |
| Default coach model | Haiku for quick questions, Sonnet for reviews | Sonnet only | Cost vs explanation quality |
| Opening stats | Lichess explorer API (online) | None, offline only | Needed for the gap finder; check its current access rules when building |

## CLAUDE.md starter for Claude Code

Put this file in the project root before the first session, together with this spec saved as `docs/SPEC.md`. Then start each phase with: "Read CLAUDE.md and docs/SPEC.md, then plan phase N."

```markdown
# Chess Workspace

Personal chess app: analysis board, game library, saved positions and
position sets, concepts wiki, repertoire builder + trainer, Stockfish,
AI coach. Full spec: docs/SPEC.md. Build ONE phase at a time, in order.
At the end of each phase: run tests, show me how to try it, and stop.

## Stack
- Monorepo with pnpm workspaces:
  - apps/web: React + TypeScript + Vite, Tailwind, chessground, chess.js
  - apps/server: Node + TypeScript + Fastify, Drizzle ORM on SQLite
    (better-sqlite3), listens on 127.0.0.1 only
  - packages/chess-core: position key, PGN parsing, repertoire graph logic
    (pure TS, no UI, fully unit-tested)
  - packages/chess-tools: Stockfish wrapper (UCI over child process) +
    position_facts; used by the server's coach AND by the MCP server
  - apps/mcp: MCP server exposing chess-tools (phase 5)
- Stockfish: native binary from stockfishchess.org, path set in Settings.
  Run it at below-normal priority, threads = cores - 2, hash 256 MB,
  stop it when the analysis panel is closed.

## Data rules
- The position key is FEN fields 1-4, with en passant kept only if a
  capture is legal. All lookups go through
  packages/chess-core/positionKey.ts, which has unit tests.
- Repertoire = a graph of edges between positions (repertoire_moves),
  never a duplicated tree.
- Several saved_positions may point at the same position. Training is
  opt-in per save (in_training, default false).
- All ids are UUIDs. Portable types only (ISO timestamps, booleans, JSON
  only where needed) so the DB can move to Supabase/Postgres later.
- All DB access lives in apps/server/db/. Nothing else writes SQL.
- Schema changes are Drizzle migrations. Never edit an old migration.
- Everything round-trips through PGN: import -> edit -> export loses nothing.

## Security and AI
- .env is in .gitignore from the first commit. The Claude API key lives
  only in apps/server/.env and never reaches the browser.
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

## Commands
- pnpm dev        # web + server
- pnpm test
- pnpm db:migrate
```
