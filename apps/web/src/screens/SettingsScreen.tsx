import { type ReactNode, useEffect, useState } from 'react';
import { type Backup, type EngineStatus, type Settings, type SettingsUpdate, type TrashItem, api } from '../api.ts';
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
  const [system, setSystem] = useState<Awaited<ReturnType<typeof api.systemInfo>> | null>(null);

  useEffect(() => {
    api.settings().then(setSettings).catch((e: Error) => ws.toast(e.message, true));
    api.trash().then(setTrash).catch(() => {});
    api.systemInfo().then(setSystem).catch(() => setSystem(null));
  }, []);

  const save = async (values: SettingsUpdate) => {
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
                  onBlur={(e) => void save({ rating: e.target.value ? Math.round(Number(e.target.value)) : null })}
                />
              </label>
            </>
          )}
        </section>

        <EngineSettings settings={settings} onSave={save} />

        <CoachSettings onSave={save} keyLocation={system ? system.envFile : 'apps/server/.env'} />

        {system?.mcpConfig ? <ClaudeAppSettings config={system.mcpConfig} /> : null}

        {system && (
          <section className="space-y-2">
            <h2 className="font-semibold">Your data</h2>
            <p className="text-sm text-muted">
              Your games, positions, repertoires, concepts, training and the API key are kept in this folder;
              uninstalling the app leaves it in place. If something goes wrong, server.log and updates.log there say
              what happened.
            </p>
            <code className="block rounded-md bg-surface-2 px-3 py-2 text-xs break-all">{system.dataDir}</code>
          </section>
        )}

        <BackupSettings />

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

function EngineSettings({ settings, onSave }: { settings: Settings | null; onSave(values: SettingsUpdate): Promise<void> }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [path, setPath] = useState('');
  const [bundled, setBundled] = useState<string | null>(null);

  useEffect(() => {
    setPath(typeof settings?.enginePath === 'string' ? settings.enginePath : '');
  }, [settings]);

  useEffect(() => {
    api
      .engineStatus()
      .then((s) => {
        setBundled(s.bundled ? (s.name ?? 'Stockfish') : null);
        if (s.bundled) setStatus(s);
      })
      .catch(() => {});
  }, []);

  // A new path is tried first and saved only if it answers as an engine; an empty one goes back to the
  // built-in Stockfish.
  const test = async () => {
    setTesting(true);
    try {
      const wanted = path.trim();
      if (wanted) {
        try {
          await api.testEngine(wanted);
        } catch (error) {
          setStatus({ configured: true, bundled: false, path: wanted, running: false, name: null, error: `${(error as Error).message} The engine in use is unchanged.` });
          return;
        }
      }
      await onSave({ enginePath: wanted });
      setStatus(await api.engineStatus());
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Engine</h2>
      {bundled ? (
        <p className="text-sm text-muted">
          The app comes with Stockfish ({bundled}), so there is nothing to set up. To use another build, paste the full path
          of its program here; leave the field empty to go back to the built-in one.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Download Stockfish from stockfishchess.org, unzip it anywhere, and paste the full path of the program here (on
          Windows it ends in <code>.exe</code>).
        </p>
      )}
      <p className="text-sm text-muted">
        It runs at below-normal priority with all cores but two and 256 MB of hash, and only while the engine panel or
        training needs it.
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
          {!status.configured ? 'No path set.' : status.error ? status.error : `Working: ${status.name}${status.bundled ? ' (built in)' : ''}.`}
        </p>
      )}
    </section>
  );
}

function CoachSettings({ onSave, keyLocation }: { onSave(values: SettingsUpdate): Promise<void>; keyLocation: string }) {
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
        <code className="break-all">{keyLocation}</code> and never reaches the pages you see.
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

/** The entry for the Claude desktop app's config, so it can use this app's chess tools. */
function ClaudeAppSettings({ config }: { config: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(config, null, 2);
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Claude desktop app</h2>
      <p className="text-sm text-muted">
        Ask about positions in the Claude desktop app with your Claude subscription, using this app's Stockfish and your
        library. In the Claude app: Settings → Developer → Edit Config, paste this in (if the file already has
        "mcpServers", add only the "chess" entry inside it), save, then quit Claude completely and open it again.
      </p>
      <pre className="max-h-64 overflow-auto rounded-md bg-surface-2 p-3 text-xs">{text}</pre>
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          await navigator.clipboard?.writeText(text);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </section>
  );
}

/** Backups of the whole library: made here on request, before updates change the database, and weekly. */
function BackupSettings() {
  const ws = useWorkspace();
  const [data, setData] = useState<{ folder: string; backups: Backup[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.backups().then(setData).catch(() => setData(null));
  }, []);
  if (!data) return null;
  const size = (bytes: number) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Backups</h2>
      <p className="text-sm text-muted">
        A backup is a full copy of your library. One is made before an update changes the database and once a week; the
        newest ten are kept. To restore one, close the app and copy it over <code>chess.db</code> in your data folder.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={`${buttonClass} shrink-0 whitespace-nowrap`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const made = await api.backUp();
              setData(made);
              ws.toast(`Backed up to ${made.backup.name}.`);
            } catch (error) {
              ws.toast((error as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <code className="min-w-0 truncate text-xs text-muted" title={data.folder}>
          {data.folder}
        </code>
      </div>
      {data.backups.length === 0 ? (
        <Empty>No backups yet.</Empty>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {data.backups.map((b) => (
            <li key={b.name} className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                {new Date(b.createdAt).toLocaleString()}
                {b.name.includes('before-update') && <span className="text-xs text-muted"> · before an update</span>}
                {b.name.includes('weekly') && <span className="text-xs text-muted"> · weekly</span>}
              </span>
              <span className="text-xs text-muted tabular-nums">{size(b.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
