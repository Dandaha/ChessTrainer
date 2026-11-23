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
pnpm test        # unit tests in every package
pnpm typecheck
```

`pnpm dev` and `pnpm db:migrate` arrive with the web app and server in phase 1.

## Layout

| Path | What it is |
| --- | --- |
| `packages/chess-core` | Position key, move tree, PGN reading and writing. Pure TypeScript, no UI. |

## Known gaps

What the app deliberately does not do yet, so nobody "fixes" it by accident:

- PGN null moves (`--`) and Chess960 castling are rejected with a clear error.
- Whitespace inside PGN comments is collapsed to single spaces on import.
- A `}` typed into a comment is written as `)`, since PGN comments cannot contain it.
