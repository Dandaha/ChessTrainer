import { type ReactNode, useEffect, useRef, useState } from 'react';

/** A modal panel. Escape or a click outside closes it. */
export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="w-full max-w-2xl rounded-xl border border-line bg-surface p-4 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-muted hover:text-text" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const buttonClass = 'rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-2';
const primaryClass = 'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90';

/** Paste or open a PGN or FEN. */
export function ImportDialog({
  onLoad,
  onClose,
}: {
  /** Returns an error message, or null when the text loaded. */
  onLoad(text: string): string | null | Promise<string | null>;
  onClose(): void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => area.current?.focus(), []);

  const load = (value = text) => {
    const settle = (problem: string | null) => (problem ? setError(problem) : onClose());
    const result = onLoad(value);
    if (result instanceof Promise) void result.then(settle);
    else settle(result);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await file.text();
    setText(content);
    load(content);
  };

  return (
    <Modal title="Open a PGN or FEN" onClose={onClose}>
      <textarea
        ref={area}
        aria-label="PGN or FEN"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) load();
        }}
        rows={12}
        spellCheck={false}
        placeholder={'[Event "…"]\n\n1. e4 e5 2. Nf3 …\n\nor a FEN: rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'}
        className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <label className={`${buttonClass} cursor-pointer`}>
          Open file…
          <input
            type="file"
            accept=".pgn,.txt,text/plain"
            className="hidden"
            onChange={(e) => void openFile(e.target.files?.[0])}
          />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            <kbd>Ctrl</kbd> <kbd>Enter</kbd>
          </span>
          <button type="button" className={primaryClass} onClick={() => load()}>
            Load
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The game as PGN, to copy or download. */
export function ExportDialog({ pgn, fileName, onClose }: { pgn: string; fileName: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard?.writeText(pgn);
    setCopied(true);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([pgn], { type: 'application/x-chess-pgn' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal title="Export PGN" onClose={onClose}>
      <textarea
        aria-label="PGN"
        readOnly
        value={pgn}
        rows={14}
        spellCheck={false}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-sm outline-none"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className={buttonClass} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={primaryClass} onClick={download}>
          Download .pgn
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['← →', 'Previous / next move'],
  ['↑ or Home', 'Starting position (at a branch, ↑ picks the line above)'],
  ['↓ or End', 'End of the line (at a branch, ↓ picks the line below; → goes into it)'],
  ['F', 'Flip the board'],
  ['/', 'Type a move'],
  ['Delete', 'Delete from the current move'],
  ['Ctrl+Z', 'Undo a delete or promotion'],
  ['E', 'Engine on / off (Stockfish runs only while it is on)'],
  ['C', 'Ask the coach'],
  ['S', 'Save the position'],
  ['R', 'Add the line to here to a repertoire'],
  ['Ctrl+S', 'Save the game to the library'],
  ['O', 'Open a PGN or FEN'],
  ['X', 'Export PGN'],
  ['Ctrl+V', 'Paste a PGN or FEN anywhere'],
  ['Right-click drag', 'Draw an arrow (Shift red, Alt blue)'],
  ['Right-click a move', 'Promote, make main line, delete'],
  ['?', 'This list'],
];

export function ShortcutsDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <table className="w-full text-sm">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={keys} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-4 font-mono whitespace-nowrap text-muted">{keys}</td>
              <td className="py-1.5">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-muted">
        Ctrl+K jumps to any screen, game or saved position.
      </p>
    </Modal>
  );
}
