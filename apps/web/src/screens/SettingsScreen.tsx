import { type ReactNode, useEffect, useState } from 'react';
import { type EngineStatus, type Settings, type TrashItem, api } from '../api.ts';
import { Empty, PageHeader, buttonClass, inputClass } from '../components/ui.tsx';
import { type Theme, applyTheme, currentTheme } from '../storage.ts';
import { useWorkspace } from '../workspace.tsx';

/** Sections later phases add (engine, coach). */
export const settingsSections: (() => ReactNode)[] = [];

export function SettingsScreen() {
  const ws = useWorkspace();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    api.settings().then(setSettings).catch((e: Error) => ws.toast(e.message, true));
    api.trash().then(setTrash).catch(() => {});
  }, []);

  const save = async (values: Settings) => {
    try {
      setSettings(await api.updateSettings(values));
    } catch (e) {
      ws.toast((e as Error).message, true);
    }
  };

  const row = 'grid grid-cols-[12rem_1fr] items-center gap-3 text-sm';

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
        <section className="space-y-3">
          <h2 className="font-semibold">You</h2>
          <label className={row}>
            <span className="text-muted">Theme</span>
            <select
              aria-label="Theme"
              className={`${inputClass} w-40`}
              value={theme}
              onChange={(e) => {
                const next = e.target.value as Theme;
                applyTheme(next);
                setTheme(next);
              }}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {settings && (
            <>
              <label className={row}>
                <span className="text-muted">Lichess username</span>
                <input aria-label="Lichess username" className={`${inputClass} w-56`} defaultValue={settings.lichessUsername ?? ''} onBlur={(e) => void save({ lichessUsername: e.target.value.trim() })} />
              </label>
              <label className={row}>
                <span className="text-muted">Chess.com username</span>
                <input aria-label="Chess.com username" className={`${inputClass} w-56`} defaultValue={settings.chesscomUsername ?? ''} onBlur={(e) => void save({ chesscomUsername: e.target.value.trim() })} />
              </label>
              <label className={row}>
                <span className="text-muted">My rating (approximate)</span>
                <input
                  aria-label="My rating"
                  type="number"
                  min={100}
                  max={3500}
                  className={`${inputClass} w-28`}
                  defaultValue={settings.rating ?? ''}
                  onBlur={(e) => void save({ rating: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
            </>
          )}
        </section>

        <EngineSettings settings={settings} onSave={save} />

        <CoachSettings onSave={save} />

        {settingsSections.map((Section, i) => (
          <Section key={i} />
        ))}

        <section className="space-y-3">
          <h2 className="font-semibold">Trash</h2>
          <p className="text-sm text-muted">Deleted games, positions, sets and collections stay here for 30 days.</p>
          {trash && trash.length === 0 && <Empty>The trash is empty.</Empty>}
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {trash?.map((item) => (
              <li key={`${item.kind}${item.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span>
                  {item.label} <span className="text-xs text-muted">· {item.kind.replace('_', ' ')} · {item.deletedAt.slice(0, 10)}</span>
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  onClick={async () => {
                    await api.restore(item.kind, item.id);
                    setTrash((t) => t?.filter((x) => x !== item) ?? null);
                    ws.toast(`Restored “${item.label}”.`);
                  }}
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function EngineSettings({ settings, onSave }: { settings: Settings | null; onSave(values: Settings): Promise<void> }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [path, setPath] = useState('');

  useEffect(() => {
    setPath(typeof settings?.enginePath === 'string' ? settings.enginePath : '');
  }, [settings]);

  const test = async () => {
    setTesting(true);
    await onSave({ enginePath: path.trim() });
    try {
      setStatus(await api.engineStatus());
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Engine</h2>
      <p className="text-sm text-muted">
        Download Stockfish from stockfishchess.org, unzip it anywhere, and paste the full path of the program here (on
        Windows it ends in <code>.exe</code>). It runs at below-normal priority with all cores but two and 256 MB of hash,
        and only while the engine panel or training needs it.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Stockfish path"
          className={`${inputClass} min-w-0 flex-1`}
          placeholder={'C:\\Chess\\stockfish\\stockfish-windows-x86-64-avx2.exe'}
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button type="button" className={buttonClass} disabled={testing} onClick={() => void test()}>
          {testing ? 'Starting…' : 'Save and test'}
        </button>
      </div>
      {status && (
        <p className={`text-sm ${status.error || !status.configured ? 'text-danger' : 'text-accent'}`}>
          {!status.configured ? 'No path set.' : status.error ? status.error : `Working: ${status.name}.`}
        </p>
      )}
    </section>
  );
}

function CoachSettings({ onSave }: { onSave(values: Settings): Promise<void> }) {
  const ws = useWorkspace();
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.coachStatus>> | null>(null);
  const [key, setKey] = useState('');
  const load = () => api.coachStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  if (!status) return null;
  const names: Record<string, string> = { 'claude-haiku-5-5': 'Claude Haiku 5.5 (fast, cheapest)', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-opus-5-5': 'Claude Opus 5.5 (most capable)' };
  const total = status.month.reduce((sum, m) => sum + m.costUsd, 0);
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Coach</h2>
      <p className="text-sm text-muted">
        The in-app coach uses the Claude API with your own key, billed per use and separately from a Claude subscription. Set a
        monthly spending limit in the Claude Console so there are no surprises. The key is stored only in{' '}
        <code>apps/server/.env</code> and never reaches this browser.
      </p>
      {status.connected ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-accent">Connected.</span>
          <button
            type="button"
            className={buttonClass}
            onClick={async () => {
              await api.removeCoachKey();
              await load();
              ws.toast('Removed the API key.');
            }}
          >
            Remove the key
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.setCoachKey(key);
              setKey('');
              await load();
              ws.toast('The coach is connected.');
            } catch (error) {
              ws.toast((error as Error).message, true);
            }
          }}
        >
          <input
            aria-label="Claude API key"
            type="password"
            autoComplete="off"
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" className={buttonClass} disabled={!key.trim()}>
            Save key
          </button>
        </form>
      )}
      <div className="grid grid-cols-[12rem_1fr] items-center gap-3 text-sm">
        <span className="text-muted">Quick questions</span>
        <select
          aria-label="Model for quick questions"
          className={`${inputClass} w-72`}
          defaultValue={status.quickModel}
          onChange={(e) => void onSave({ coachQuickModel: e.target.value })}
        >
          {status.models.map((m) => (
            <option key={m} value={m}>
              {names[m] ?? m}
            </option>
          ))}
        </select>
        <span className="text-muted">Plans, openings, game reviews</span>
        <select
          aria-label="Model for deeper answers"
          className={`${inputClass} w-72`}
          defaultValue={status.deepModel}
          onChange={(e) => void onSave({ coachDeepModel: e.target.value })}
        >
          {status.models.map((m) => (
            <option key={m} value={m}>
              {names[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      {status.month.length > 0 && (
        <p className="text-sm text-muted">
          This month: {status.month.map((m) => `${m.answers} answer${m.answers === 1 ? '' : 's'} with ${(names[m.model ?? ''] ?? m.model ?? '').split(' (')[0]}`).join(', ')} · about $
          {total.toFixed(2)} (an estimate from the token counts).
        </p>
      )}
    </section>
  );
}
