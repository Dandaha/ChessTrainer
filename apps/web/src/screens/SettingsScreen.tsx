import { type ReactNode, useEffect, useState } from 'react';
import { type Settings, type TrashItem, api } from '../api.ts';
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
