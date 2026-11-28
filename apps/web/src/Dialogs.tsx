import { type ReactNode, useEffect, useRef, useState } from 'react';
import { readTextFile } from './files.ts';

/** Open dialogs, newest last: only the top one answers Escape, so closing a question keeps its parent. */
const openDialogs: symbol[] = [];

/** Whether a dialog is open: a screen's own keys (arrows, letters) stay out of the way while one is. */
export function dialogOpen(): boolean {
  return openDialogs.length > 0;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * What every dialog does, as the WAI-ARIA dialog pattern asks: Escape closes the top one only, Tab
 * stays inside it, and when it closes the focus goes back to where it was.
 */
export function useDialog(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const me = Symbol('dialog');
    openDialogs.push(me);
    const before = document.activeElement as HTMLElement | null;
    // Focus something inside unless the dialog already did (an input it focuses itself).
    const settle = requestAnimationFrame(() => {
      const box = ref.current;
      if (box && !box.contains(document.activeElement)) box.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== me) return;
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (!items.length) return;
        const first = items[0]!;
        const last = items.at(-1)!;
        if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !ref.current.contains(document.activeElement))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelAnimationFrame(settle);
      window.removeEventListener('keydown', onKey, true);
      openDialogs.splice(openDialogs.indexOf(me), 1);
      if (before && document.contains(before)) before.focus();
    };
  }, [ref]);
}

/**
 * A modal panel. Escape, ✕ or a click outside closes it; but a click outside only when it also
 * started outside (not a text selection let go past the edge), and not once anything has been typed
 * or changed in it, so a stray click never throws away what was written.
 */
export function Modal({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);
  const pressedOutside = useRef(false);
  const changed = useRef(false);

  return (
    // The overlay scrolls: a dialog taller than the window (a form with every field open) can still be
    // read to its end and its buttons reached.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-[10vh]"
      onPointerDown={(e) => {
        pressedOutside.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOutside.current && !changed.current) onClose();
      }}
      data-overlay
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-2xl min-w-0 rounded-xl border border-line bg-surface p-4 shadow-panel"
        onClick={(e) => e.stopPropagation()}
        onInput={() => {
          changed.current = true;
        }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{title}</h2>
          <button type="button" onClick={onClose} className="shrink-0 text-muted hover:text-text" aria-label="Close">
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
  /** Returns an error message, null when the text loaded, or false when it was not loaded on purpose
   * (the edited game kept): the dialog then stays, with the text. */
  onLoad(text: string): string | null | false | Promise<string | null | false>;
  onClose(): void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => area.current?.focus(), []);

  const load = (value = text) => {
    const settle = (problem: string | null | false) => {
      if (problem === false) return;
      if (problem) setError(problem);
      else onClose();
    };
    const result = onLoad(value);
    if (result instanceof Promise) void result.then(settle);
    else settle(result);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const content = await readTextFile(file);
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
        className="w-full rounded-md border border-field bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-accent"
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
        className="w-full rounded-md border border-field bg-bg px-2 py-1.5 font-mono text-sm outline-none"
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
  ['Mouse wheel', 'Previous / next move, over the board'],
  ['↑ or Home', 'Starting position (at a branch, ↑ picks the line above)'],
  ['↓ or End', 'End of the line (at a branch, ↓ picks the line below; → goes into it)'],
  ['F', 'Flip the board'],
  ['/', 'Type a move'],
  ['Delete', 'Delete from the current move'],
  ['Ctrl+Z', 'Undo the last change: a move, a delete, a comment, a drawing'],
  ['Ctrl+Y', 'Redo what Ctrl+Z took back (Ctrl+Shift+Z too)'],
  ['E', 'Engine on / off (Stockfish runs only while it is on)'],
  ['Space', "Play the engine's best move"],
  ['T', 'Threat: what the opponent would play if it were their move'],
  ['C', 'Ask the coach'],
  ['S', 'Save the position'],
  ['R', 'Add the line to here to a repertoire'],
  ['Ctrl+S', 'Save the game to the library'],
  ['O', 'Open a PGN or FEN'],
  ['X', 'Export PGN'],
  ['Ctrl+V', 'Paste a PGN or FEN anywhere'],
  ['Right-click drag', 'Draw an arrow (Shift red, Alt blue)'],
  ['Right-click a move', 'Promote, make main line, delete'],
  ['Esc', 'Close a dialog or menu; leave a box you are typing in'],
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
