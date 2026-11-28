import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from '../Dialogs.tsx';
import { buttonClass, inputClass, primaryClass } from './ui.tsx';

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

/** A yes/no question in place of window.confirm(); the safe answer is the default. */
export interface ConfirmOptions {
  title: string;
  message: string;
  /** The button that goes ahead, e.g. "Discard changes". */
  confirm: string;
  /** The button that keeps things as they are. */
  cancel?: string;
}
type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm outside AskTextProvider');
  return confirm;
}

export function AskTextProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [question, setQuestion] = useState<(ConfirmOptions & { resolve(ok: boolean): void }) | null>(null);
  const ask = useCallback<Ask>(
    (title, initial = '', placeholder = '') =>
      new Promise((resolve) => setPending({ title, initial, placeholder, resolve })),
    [],
  );
  const confirm = useCallback<Confirm>((options) => new Promise((resolve) => setQuestion({ ...options, resolve })), []);
  const finish = (value: string | null) => {
    pending?.resolve(value?.trim() ? value.trim() : null);
    setPending(null);
  };
  const answer = (ok: boolean) => {
    question?.resolve(ok);
    setQuestion(null);
  };
  return (
    <Context.Provider value={ask}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        {pending && <AskBox pending={pending} onDone={finish} />}
        {question && <ConfirmBox question={question} onDone={answer} />}
      </ConfirmContext.Provider>
    </Context.Provider>
  );
}

function ConfirmBox({ question, onDone }: { question: ConfirmOptions; onDone(ok: boolean): void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  return (
    <Modal title={question.title} onClose={() => onDone(false)}>
      <p className="mb-4 text-sm">{question.message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className={primaryClass} ref={keep} onClick={() => onDone(false)}>
          {question.cancel ?? 'Cancel'}
        </button>
        <button type="button" className={buttonClass} onClick={() => onDone(true)}>
          {question.confirm}
        </button>
      </div>
    </Modal>
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
