import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from '../Dialogs.tsx';
import { inputClass, primaryClass } from './ui.tsx';

/**
 * A small "name it" box, in place of window.prompt(), which the desktop app
 * (Electron) does not support. `ask` resolves with the text, or null if cancelled.
 */

type Ask = (title: string, initial?: string, placeholder?: string) => Promise<string | null>;

const Context = createContext<Ask | null>(null);

export function useAskText(): Ask {
  const ask = useContext(Context);
  if (!ask) throw new Error('useAskText outside AskTextProvider');
  return ask;
}

interface Pending {
  title: string;
  initial: string;
  placeholder: string;
  resolve(value: string | null): void;
}

export function AskTextProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback<Ask>(
    (title, initial = '', placeholder = '') =>
      new Promise((resolve) => setPending({ title, initial, placeholder, resolve })),
    [],
  );
  const finish = (value: string | null) => {
    pending?.resolve(value?.trim() ? value.trim() : null);
    setPending(null);
  };
  return (
    <Context.Provider value={ask}>
      {children}
      {pending && <AskBox pending={pending} onDone={finish} />}
    </Context.Provider>
  );
}

function AskBox({ pending, onDone }: { pending: Pending; onDone(value: string | null): void }) {
  const [value, setValue] = useState(pending.initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <Modal title={pending.title} onClose={() => onDone(null)}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(value);
        }}
      >
        <input
          ref={input}
          aria-label={pending.title}
          className={`${inputClass} min-w-0 flex-1`}
          value={value}
          placeholder={pending.placeholder}
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className={primaryClass} disabled={!value.trim()}>
          OK
        </button>
      </form>
    </Modal>
  );
}
