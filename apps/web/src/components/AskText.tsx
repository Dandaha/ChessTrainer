import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from '../Dialogs.tsx';
import { buttonClass, inputClass, primaryClass } from './ui.tsx';

/**
 * A small "name it" box, in place of window.prompt(), which the desktop app
 * (Electron) does not support. `ask` resolves with the text, or null if cancelled.
 * With `save`, the box stays open until saving the text works, and shows why it did not
 * (e.g. "There is already a set called …"), so the name can be changed there and then.
 */

type Ask = (title: string, initial?: string, placeholder?: string, save?: (value: string) => Promise<unknown>) => Promise<string | null>;

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
  save?: (value: string) => Promise<unknown>;
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
    (title, initial = '', placeholder = '', save) =>
      new Promise((resolve) => setPending({ title, initial, placeholder, save, resolve })),
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
    <Modal title={question.title} onClose={() => onDone(false)} size="sm">
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <Modal title={pending.title} onClose={() => onDone(null)} size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const text = value.trim();
          if (!text || busy) return;
          if (pending.save) {
            setBusy(true);
            try {
              await pending.save(text);
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
              input.current?.focus();
              return;
            }
          }
          onDone(text);
        }}
      >
        <div className="flex gap-2">
          <input
            ref={input}
            aria-label={pending.title}
            aria-invalid={!!error}
            aria-describedby={error ? 'ask-error' : undefined}
            className={`${inputClass} min-w-0 flex-1`}
            value={value}
            // Every name the app asks for (a set, a collection, a category, a repertoire) fits in 200.
            maxLength={200}
            placeholder={pending.placeholder}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          <button type="submit" className={primaryClass} disabled={!value.trim() || busy}>
            OK
          </button>
        </div>
        {error && (
          <p id="ask-error" role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
