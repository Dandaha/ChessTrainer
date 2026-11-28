import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { type Backup, type EngineStatus, type Settings, type SettingsUpdate, type TrashItem, type UpdateInfo, api } from '../api.ts';
import { Empty, PageHeader, Toggle, buttonClass, dangerClass, inputClass, primaryClass } from '../components/ui.tsx';
import { useConfirm } from '../components/AskText.tsx';
import { type Theme, applyTheme, useTheme } from '../storage.ts';
import { useWorkspace } from '../workspace.tsx';

/** Sections later phases add (engine, coach). */
export const settingsSections: (() => ReactNode)[] = [];

type SaveStatus = { kind: 'saved' } | { kind: 'error'; text: string } | null;

/** Runs a save and says how it went: "Saved" for a moment, or what was wrong, until the next try. */
function useSaveStatus(): [SaveStatus, (save: () => Promise<unknown>) => Promise<void>] {
  const [status, setStatus] = useState<SaveStatus>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const run = async (save: () => Promise<unknown>) => {
    window.clearTimeout(timer.current);
    try {
      await save();
      setStatus({ kind: 'saved' });
      timer.current = window.setTimeout(() => setStatus(null), 2500);
    } catch (error) {
      setStatus({ kind: 'error', text: (error as Error).message });
    }
  };
  return [status, run];
}

function SaveNote({ status, id }: { status: SaveStatus; id?: string }) {
  if (!status) return null;
  return status.kind === 'saved' ? (
    <span id={id} role="status" className="text-xs text-accent">
      Saved
    </span>
  ) : (
    <span id={id} role="alert" className="text-xs text-danger">
      {status.text}
    </span>
  );
}

/**
 * A setting typed in a box: checked, then saved when it loses focus or on Enter, only if it changed,
 * with "Saved" or what is wrong beside it.
 */
function SettingInput({
  label,
  initial,
  width,
  type = 'text',
  check,
  save,
}: {
  label: string;
  initial: string;
  width: string;
  type?: 'text' | 'number';
  /** What is wrong with a value, or null. */
  check(value: string): string | null;
  save(value: string): Promise<unknown>;
}) {
  const [value, setValue] = useState(initial);
  const [status, run] = useSaveStatus();
  const saved = useRef(initial);
  const id = useId();
  const commit = () => {
    if (value.trim() === saved.current.trim()) {
      // Back to what is saved: nothing to save, and nothing wrong any more.
      if (status?.kind === 'error') void run(() => Promise.resolve());
      return;
    }
    const problem = check(value.trim());
    if (problem) return void run(() => Promise.reject(new Error(problem)));
    void run(async () => {
      await save(value.trim());
      saved.current = value;
    });
  };
  return (
    <label className="grid grid-cols-[12rem_1fr] items-center gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <input
          aria-label={label}
          type={type}
          className={`${inputClass} ${width} ${status?.kind === 'error' ? 'border-danger' : ''}`}
          value={value}
          aria-invalid={status?.kind === 'error'}
          aria-describedby={status ? id : undefined}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
        />
        <SaveNote status={status} id={id} />
      </span>
    </label>
  );
}

/** Lichess names: 2–30 letters, digits, _ or -; Chess.com's: 3–25 of the same. */
const usernameCheck = (site: string, min: number, max: number) => (value: string) =>
  !value || new RegExp(`^[A-Za-z0-9_-]{${min},${max}}$`).test(value)
    ? null
    : `A ${site} username is ${min} to ${max} letters, digits, _ or -.`;

export function SettingsScreen() {
  const ws = useWorkspace();
  const confirm = useConfirm();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [trashShown, setTrashShown] = useState(100);
  const theme = useTheme();
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
  /** A save whose failure the caller shows (beside the field). */
  const saveStrict = async (values: SettingsUpdate) => setSettings(await api.updateSettings(values));

  const row = 'grid grid-cols-[12rem_1fr] items-center gap-3 text-sm';

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Settings" />
      <div className="mx-auto w-full max-w-3xl space-y-8 p-6">
        <section className="space-y-3">
          <h2 className="font-semibold">You</h2>
          <p className="text-sm text-muted">
            Your usernames import your games and mark which side you played in them; your rating tells the coach
            and the gap finder what level to aim at. All optional.
          </p>
          <label className={row}>
            <span className="text-muted">Theme</span>
            <select
              aria-label="Theme"
              className={`${inputClass} w-40`}
              value={theme}
              onChange={(e) => applyTheme(e.target.value as Theme)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {settings && (
            <>
              <SettingInput
                label="Lichess username"
                width="w-56"
                initial={typeof settings.lichessUsername === 'string' ? settings.lichessUsername : ''}
                check={usernameCheck('Lichess', 2, 30)}
                save={(value) => saveStrict({ lichessUsername: value })}
              />
              <SettingInput
                label="Chess.com username"
                width="w-56"
                initial={typeof settings.chesscomUsername === 'string' ? settings.chesscomUsername : ''}
                check={usernameCheck('Chess.com', 3, 25)}
                save={(value) => saveStrict({ chesscomUsername: value })}
              />
              <SettingInput
                label="My rating"
                type="number"
                width="w-28"
                initial={typeof settings.rating === 'number' ? String(settings.rating) : ''}
                check={(value) => (!value || (/^\d+$/.test(value) && Number(value) >= 100 && Number(value) <= 3500) ? null : 'A rating from 100 to 3500.')}
                save={(value) => saveStrict({ rating: value ? Number(value) : null })}
              />
            </>
          )}
        </section>

        <LichessSettings keyLocation={system ? system.envFile : 'apps/server/.env'} />

        <EngineSettings settings={settings} onSave={save} />

        <CoachSettings onSave={save} keyLocation={system ? system.envFile : 'apps/server/.env'} />

        {system?.mcpConfig ? <ClaudeAppSettings config={system.mcpConfig} /> : null}

        <UpdateSettings />

        {system && (
          <section className="space-y-2">
            <h2 className="font-semibold">Your data</h2>
            <p className="text-sm text-muted">
              Your games, positions, repertoires, concepts, training and the API key are kept in this folder;
              uninstalling the app leaves it in place. If something goes wrong, server.log and updates.log there say
              what happened.
            </p>
            <code className="block rounded-md bg-surface-2 px-3 py-2 text-xs break-all">{system.dataDir}</code>
            {system.canOpenFolders && <OpenFolder which="data" label="Open the folder" />}
          </section>
        )}

        <BackupSettings canOpen={!!system?.canOpenFolders} />

        {settingsSections.map((Section, i) => (
          <Section key={i} />
        ))}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Trash</h2>
            {trash && trash.length > 0 && (
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  onClick={async () => {
                    const { restored } = await api.restoreAll();
                    setTrash([]);
                    ws.toast(`Restored ${restored} item${restored === 1 ? '' : 's'}.`);
                  }}
                >
                  Restore all
                </button>
                <button
                  type="button"
                  className={dangerClass}
                  onClick={async () => {
                    const sure = await confirm({
                      title: 'Empty the trash?',
                      message: `The ${trash.length} item${trash.length === 1 ? '' : 's'} in the trash will be deleted for good. This cannot be undone (a backup made before can still bring them back).`,
                      confirm: 'Delete for good',
                      cancel: 'Keep them',
                    });
                    if (!sure) return;
                    await api.emptyTrash();
                    setTrash([]);
                    ws.toast('The trash is empty.');
                  }}
                >
                  Empty trash
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-muted">Deleted games, positions, sets, collections, repertoires and concepts stay here for 30 days.</p>
          {trash && trash.length === 0 && <Empty>The trash is empty.</Empty>}
          {trash && trash.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {trash.slice(0, trashShown).map((item) => (
              <li key={`${item.kind}${item.id}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
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
          )}
          {/* A big import deleted by mistake fills the trash: it shows a page at a time. */}
          {trash && trash.length > trashShown && (
            <button type="button" className={buttonClass} onClick={() => setTrashShown((n) => n + 100)}>
              Show more ({(trash.length - trashShown).toLocaleString('en')} more)
            </button>
          )}
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
  const [modelStatus, runModel] = useSaveStatus();
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
        <>
        <p className="text-sm">Coach not connected: paste a Claude API key here to turn it on.</p>
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
        </>
      )}
      <div className="grid grid-cols-[12rem_1fr] items-center gap-3 text-sm">
        <span className="text-muted">Quick questions</span>
        <select
          aria-label="Model for quick questions"
          className={`${inputClass} w-72`}
          defaultValue={status.quickModel}
          onChange={(e) => void runModel(() => onSave({ coachQuickModel: e.target.value }))}
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
          onChange={(e) => void runModel(() => onSave({ coachDeepModel: e.target.value }))}
        >
          {status.models.map((m) => (
            <option key={m} value={m}>
              {names[m] ?? m}
            </option>
          ))}
        </select>
        <span />
        <SaveNote status={modelStatus} />
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
/** "11:42" today, a date and time before. */
function whenChecked(iso: string): string {
  const at = new Date(iso);
  return at.toDateString() === new Date().toDateString()
    ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The installed app's version and where its updates stand: checking, downloading (with how far),
 * ready to restart into, or why a check failed. It follows along while something is happening.
 * Only the desktop app answers; the browser version shows nothing here.
 */
/**
 * A version as people read it: a stable one by its two numbers ("1.0"), a test version whole and
 * marked ("1.0.80 (test version)"). The 0.1.x builds from before stable versions stay as they are.
 */
export function shownVersion(version: string): string {
  const [major, minor, patch] = version.split('.');
  if (Number(major) < 1) return version;
  return patch === '0' ? `${major}.${minor}` : `${version} (test version)`;
}

function UpdateSettings() {
  const ws = useWorkspace();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    api.updates().then(setInfo).catch(() => setInfo(null));
  }, []);
  // Every second while checking or downloading; now and then otherwise, for a check the app makes itself.
  useEffect(() => {
    if (!info || info.status.state === 'unavailable') return;
    const active = info.status.state === 'checking' || info.status.state === 'downloading';
    const timer = window.setTimeout(() => api.updates().then(setInfo).catch(() => {}), active ? 1000 : 15_000);
    return () => window.clearTimeout(timer);
  }, [info]);

  if (!info) return null;
  const { status } = info;
  const check = async () => {
    try {
      setInfo(await api.checkForUpdates());
    } catch (error) {
      ws.toast((error as Error).message, true);
    }
  };
  const checkButton = (label: string) => (
    <button type="button" className={`${buttonClass} shrink-0`} onClick={() => void check()}>
      {label}
    </button>
  );

  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Updates</h2>
      <p className="text-sm">Chess Workspace {shownVersion(info.version)}</p>
      <div aria-live="polite" className="space-y-2 text-sm">
        {status.state === 'unavailable' && <p className="text-muted">Updates come only to the installed app.</p>}
        {status.state === 'idle' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted">Not checked yet since the app opened.</p>
            {checkButton('Check for updates')}
          </div>
        )}
        {status.state === 'checking' && <p className="text-muted">Checking for updates…</p>}
        {status.state === 'up-to-date' && (
          <div className="flex flex-wrap items-center gap-3">
            <p>
              Up to date. <span className="text-muted">Checked at {whenChecked(status.checkedAt)}.</span>
            </p>
            {checkButton('Check for updates')}
          </div>
        )}
        {status.state === 'downloading' && (
          <>
            <p>
              Downloading {shownVersion(status.version)}… {status.percent}%
            </p>
            <div
              role="progressbar"
              aria-label="Update download"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status.percent}
              className="h-1.5 max-w-sm overflow-hidden rounded-full bg-surface-2"
            >
              <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${status.percent}%` }} />
            </div>
          </>
        )}
        {status.state === 'ready' && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-medium">Version {shownVersion(status.version)} is ready.</p>
            <button
              type="button"
              className={`${primaryClass} shrink-0`}
              disabled={restarting}
              onClick={async () => {
                setRestarting(true);
                try {
                  await api.restartToUpdate();
                } catch (error) {
                  setRestarting(false);
                  ws.toast((error as Error).message, true);
                }
              }}
            >
              {restarting ? 'Restarting…' : 'Restart now'}
            </button>
            <p className="w-full text-muted">Or keep working: it installs by itself when you close the app.</p>
          </div>
        )}
        {status.state === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <p>
              <span className="text-danger">Couldn’t check for updates: {status.message}</span>{' '}
              <span className="text-muted">({whenChecked(status.checkedAt)})</span>
            </p>
            {checkButton('Try again')}
          </div>
        )}
      </div>
      {status.state !== 'unavailable' && (
        <div className="space-y-1">
          <div className="-ml-1">
            <Toggle
              on={info.testVersions}
              label="Test versions"
              onToggle={async () => {
                try {
                  setInfo(await api.setTestVersions(!info.testVersions));
                } catch (error) {
                  ws.toast((error as Error).message, true);
                }
              }}
            />
          </div>
          <p className="text-xs text-muted">
            Every new build as soon as it is made, to try changes out. Off, the app takes only the versions released as stable.
          </p>
        </div>
      )}
    </section>
  );
}

/** Opens the data folder or the backups in Explorer (the installed app only). */
function OpenFolder({ which, label }: { which: 'data' | 'backups'; label: string }) {
  const ws = useWorkspace();
  return (
    <button
      type="button"
      className={buttonClass}
      onClick={async () => {
        try {
          await api.openFolder(which);
        } catch (error) {
          ws.toast((error as Error).message, true);
        }
      }}
    >
      {label}
    </button>
  );
}

function BackupSettings({ canOpen }: { canOpen: boolean }) {
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
        <code className="min-w-0 text-xs text-muted [overflow-wrap:anywhere]" title={data.folder}>
          {data.folder}
        </code>
        {canOpen && <OpenFolder which="backups" label="Open the backups" />}
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

/** The personal Lichess token the opening explorer needs (Find gaps, opening statistics). */
function LichessSettings({ keyLocation }: { keyLocation: string }) {
  const ws = useWorkspace();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api
      .lichessToken()
      .then((r) => setConnected(r.connected))
      .catch(() => setConnected(null));
  }, []);
  if (connected === null) return null;
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">Lichess</h2>
      <p className="text-sm text-muted">
        Find gaps and the opening statistics use the Lichess opening explorer, which needs a personal token. Create one at{' '}
        <a className="text-accent hover:underline" href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
          lichess.org/account/oauth/token
        </a>{' '}
        with no permissions ticked, and paste it here. It is stored only in <code className="break-all">{keyLocation}</code>.
      </p>
      {connected ? (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-accent">Connected.</span>
          <button
            type="button"
            className={buttonClass}
            onClick={async () => {
              await api.removeLichessToken();
              setConnected(false);
              ws.toast('Removed the Lichess token.');
            }}
          >
            Remove the token
          </button>
        </div>
      ) : (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const result = await api.setLichessToken(token);
              setToken('');
              setConnected(true);
              ws.toast(result.username ? `Connected to Lichess as ${result.username}.` : 'Connected to Lichess.');
            } catch (error) {
              ws.toast((error as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            aria-label="Lichess token"
            type="password"
            autoComplete="off"
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="lip_…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button type="submit" className={buttonClass} disabled={!token.trim() || busy}>
            {busy ? 'Checking…' : 'Save token'}
          </button>
        </form>
      )}
    </section>
  );
}
