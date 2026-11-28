import { START_FEN, addMove, createGame, isValidFen, parseGame } from '@chess/chess-core';
import { type ReactNode, useMemo } from 'react';
import { useWorkspace } from '../workspace.tsx';
import { MiniBoard } from './MiniBoard.tsx';

/**
 * A small, safe markdown renderer for notes and concept pages. It builds React
 * elements (never raw HTML), so pasted text cannot inject anything.
 *
 * Besides headings, lists, **bold**, *italic*, `code` and [links](https://…):
 * - a line that is a FEN, or a ```fen block, becomes a board;
 * - a ```line (or ```pgn) block becomes a board after those moves;
 * - a run of moves in the text ("1. e4 e5 2. Nf3") becomes a link that opens
 *   the line on the analysis board, from the last board shown above it, else
 *   from `fen`, else from the starting position.
 */
export function Markdown({ text, fen = START_FEN }: { text: string; fen?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  // Moves written after a board are read from that board's position.
  let base = fen;
  return (
    <div className="min-w-0 space-y-2 text-sm leading-relaxed [overflow-wrap:anywhere]">
      {blocks.map((b, i) => {
        if (b.kind === 'board') base = b.fen;
        return renderBlock(b, i, base);
      })}
    </div>
  );
}

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'board'; fen: string }
  | { kind: 'line'; moves: string }
  | { kind: 'code'; text: string };

const BULLET = /^([-*]|\d+[.)])\s+/;

/** "- point", "* point", "1. point" or "1) point", but not "1. e4 e5", which is a line of moves. */
function listItem(line: string): boolean {
  // A move right after the number ("1. e4", "12. Nf3", "3. O-O") makes it moves; "4. fourth" is an item.
  return BULLET.test(line) && !/^\d+\.(?:\.\.)?\s*(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)(?![\w-])/.test(line);
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    const fence = /^```(\w*)\s*$/.exec(trimmed);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!.trim())) body.push(lines[i++]!);
      i += 1;
      const content = body.join('\n').trim();
      const kind = fence[1]!.toLowerCase();
      if (kind === 'fen' && isValidFen(content)) blocks.push({ kind: 'board', fen: content });
      else if (kind === 'line' || kind === 'pgn') blocks.push({ kind: 'line', moves: content });
      else blocks.push({ kind: 'code', text: content });
      continue;
    }
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (isValidFen(trimmed) && trimmed.includes('/')) {
      blocks.push({ kind: 'board', fen: trimmed });
      i += 1;
      continue;
    }
    // #### and deeper read as the smallest heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({ kind: 'heading', level: Math.min(heading[1]!.length, 3), text: heading[2]! });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }
    if (listItem(trimmed)) {
      const ordered = /^\d/.test(trimmed);
      const items: string[] = [];
      // A numbered list ends where bullets start, and the other way round; an indented line under an
      // item goes on with that item.
      while (i < lines.length) {
        const line = lines[i]!;
        const t = line.trim();
        if (listItem(t) && /^\d/.test(t) === ordered) items.push(t.replace(BULLET, ''));
        else if (t && /^\s+/.test(line) && !listItem(t) && items.length) items[items.length - 1] += ` ${t}`;
        else break;
        i += 1;
      }
      // "3. …" starts the list at 3, as written.
      blocks.push({ kind: 'list', ordered, start: ordered ? Number(/^\d+/.exec(trimmed)![0]) : 1, items });
      continue;
    }
    // A paragraph runs until a blank line, or a line that starts something else: a board, a list, a
    // heading, a quote or a block of moves.
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i]!.trim();
      if (!t || /^```/.test(t) || /^#{1,6}\s/.test(t) || t.startsWith('>') || (para.length && listItem(t)) || (isValidFen(t) && t.includes('/'))) break;
      para.push(t);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

function renderBlock(block: Block, key: number, fen: string): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const cls = ['', 'text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold'][block.level];
      return (
        <p key={key} className={cls} role="heading" aria-level={block.level + 1}>
          <Inline text={block.text} fen={fen} />
        </p>
      );
    }
    case 'paragraph':
      return (
        <p key={key}>
          <Inline text={block.text} fen={fen} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} start={block.ordered && block.start !== 1 ? block.start : undefined} className={`${block.ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>
          {block.items.map((item, i) => (
            <li key={i}>
              <Inline text={item} fen={fen} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-line pl-3 text-muted">
          <Inline text={block.text} fen={fen} />
        </blockquote>
      );
    case 'board':
      return <EmbeddedBoard key={key} fen={block.fen} />;
    case 'line':
      return <EmbeddedLine key={key} moves={block.moves} fen={fen} />;
    case 'code':
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-surface-2 p-2 text-xs">
          {block.text}
        </pre>
      );
  }
}

function EmbeddedBoard({ fen }: { fen: string }) {
  const ws = useWorkspace();
  return (
    <button type="button" onClick={() => ws.openFen(fen)} className="block w-56 max-w-full" title="Open on the board">
      <MiniBoard fen={fen} flipped={fen.split(' ')[1] === 'b'} coordinates />
    </button>
  );
}

/** The moves of a line from a position, or null if they are not legal there. */
export function playLine(fen: string, moves: string): { fen: string; sans: string[] } | null {
  try {
    if (/^\s*\[/.test(moves)) {
      const game = parseGame(moves);
      let node = game.root;
      const sans: string[] = [];
      while (node.children[0]) {
        node = node.children[0];
        sans.push(node.san);
      }
      return { fen: node.fen, sans };
    }
    let node = createGame(fen).root;
    const sans: string[] = [];
    for (const token of moves.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter(Boolean)) {
      if (/^(1-0|0-1|1\/2-1\/2|\*)$/.test(token)) break;
      node = addMove(node, token.replace(/[!?]+$/, ''));
      sans.push(node.san);
    }
    return sans.length ? { fen: node.fen, sans } : null;
  } catch {
    return null;
  }
}

function EmbeddedLine({ moves, fen }: { moves: string; fen: string }) {
  const ws = useWorkspace();
  // From the board above it, or, when the moves don't fit there, from the starting position.
  const base = playLine(fen, moves) ? fen : START_FEN;
  const played = playLine(base, moves);
  if (!played)
    return (
      <div className="space-y-1">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs">{moves}</pre>
        <p className="text-xs text-danger">These moves are not legal from the board above or from the start, so no board is shown.</p>
      </div>
    );
  return (
    <div className="space-y-1">
      <button type="button" onClick={() => ws.openLine(base, played.sans)} className="block w-56 max-w-full" title="Open the line on the board">
        <MiniBoard fen={played.fen} coordinates />
      </button>
      <p className="text-xs text-muted">{moves}</p>
    </div>
  );
}

// A run of numbered moves: "1. e4 e5 2. Nf3" or "14...Nd7 15. Bd3".
const MOVES = /\b\d+\.(?:\.\.)?\s*(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?[!?]*(?:\s+(?:\d+\.(?:\.\.)?\s*)?(?:[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|O-O(?:-O)?)[+#]?[!?]*)*/g;
const INLINE = /(\*\*[^*]+\*\*|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<!\w)_[^_\s][^_]*_(?!\w)|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function Inline({ text, fen }: { text: string; fen: string }) {
  return <>{formatted(text, 'i', fen)}</>;
}

/** Plain text with runs of moves turned into links that open the line on the board. */
function Moves({ text, fen }: { text: string; fen: string }) {
  const ws = useWorkspace();
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(MOVES)) {
    const start = match.index!;
    out.push(text.slice(last, start));
    const base = playLine(fen, match[0]) ? fen : START_FEN;
    const played = playLine(base, match[0]);
    out.push(
      played ? (
        <button
          key={`m${start}`}
          type="button"
          onClick={() => ws.openLine(base, played.sans)}
          className="font-medium text-accent hover:underline"
          title="Open this line on the board"
        >
          {match[0]}
        </button>
      ) : (
        match[0]
      ),
    );
    last = start + match[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

function formatted(text: string, keyBase: string, fen: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key}><Moves text={part.slice(2, -2)} fen={fen} /></strong>;
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(part)) return <em key={key}><Moves text={part.slice(1, -1)} fen={fen} /></em>;
    if (/^`[^`]+`$/.test(part)) return <code key={key} className="rounded bg-surface-2 px-1 text-xs">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = link[2]!;
      const safe = /^(https?:\/\/|#\/)/.test(href);
      return safe ? (
        <a key={key} href={href} className="text-accent hover:underline" {...(href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
          {link[1]}
        </a>
      ) : (
        link[1]
      );
    }
    return <Moves key={key} text={part} fen={fen} />;
  });
}
