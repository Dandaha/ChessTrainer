import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { CommandPalette } from './components/CommandPalette.tsx';
import { useRoute } from './router.ts';
import { BoardScreen, isTyping } from './screens/BoardScreen.tsx';
import { GamesScreen } from './screens/GamesScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { PositionsScreen } from './screens/PositionsScreen.tsx';
import { PresentScreen } from './screens/PresentScreen.tsx';
import { PrintScreen } from './screens/PrintScreen.tsx';
import { RepertoireScreen } from './screens/RepertoireScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { type Theme, applyTheme, currentTheme } from './storage.ts';
import { WorkspaceProvider, useWorkspace } from './workspace.tsx';

export interface Screen {
  id: string;
  label: string;
  icon: string;
  render(): ReactNode;
}

const SCREENS: Screen[] = [
  { id: '', label: 'Home', icon: '⌂', render: () => <HomeScreen /> },
  { id: 'board', label: 'Board', icon: '♞', render: () => <BoardScreen /> },
  { id: 'games', label: 'Games', icon: '☰', render: () => <GamesScreen /> },
  { id: 'positions', label: 'Positions', icon: '▦', render: () => <PositionsScreen /> },
  { id: 'repertoire', label: 'Repertoire', icon: '⑂', render: () => <RepertoireScreen /> },
  { id: 'settings', label: 'Settings', icon: '⚙', render: () => <SettingsScreen /> },
];

export function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const ws = useWorkspace();
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const [palette, setPalette] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);
  const latest = useRef(ws);
  latest.current = ws;

  useEffect(() => {
    api
      .health()
      .then(() => setServerOnline(true))
      .catch(() => setServerOnline(false));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    // Paste a PGN or FEN anywhere (outside a text field) to open it on the board.
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      const problem = latest.current.openText(text);
      if (problem) latest.current.toast(problem, true);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };

  const [first = ''] = route.parts;
  const fullScreen = first === 'present' || first === 'print';
  const screen = SCREENS.find((s) => s.id === first) ?? SCREENS[0]!;

  return (
    <div className="flex h-full">
      {!fullScreen && (
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 md:w-44 md:items-stretch md:px-2 print:hidden">
          <div className="mb-3 hidden px-2 text-[15px] font-semibold tracking-tight md:block">
            <span className="text-accent">♞</span> Chess Workspace
          </div>
          {SCREENS.map((s) => (
            <a
              key={s.id}
              href={`#/${s.id}`}
              aria-current={s === screen ? 'page' : undefined}
              title={s.label}
              className={`flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm ${
                s === screen ? 'bg-accent-soft font-semibold text-text' : 'text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              <span className="w-4 text-center" aria-hidden>
                {s.icon}
              </span>
              <span className="hidden md:inline">{s.label}</span>
            </a>
          ))}
          <div className="mt-auto space-y-1">
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="hidden w-full rounded-md px-2.5 py-1.5 text-left text-xs text-muted hover:bg-surface-2 md:block"
            >
              Jump to… <kbd>Ctrl</kbd> <kbd>K</kbd>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              <span className="w-4 text-center">{theme === 'dark' ? '☀' : '☾'}</span>
              <span className="hidden md:inline">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
            </button>
          </div>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-auto">
          {first === 'present' && <PresentScreen setId={route.parts[1] ?? ''} />}
          {first === 'print' && <PrintScreen setId={route.parts[1] ?? ''} />}
          {!fullScreen && screen.render()}
        </main>
        {!serverOnline && !fullScreen && (
          <footer className="border-t border-line bg-surface px-4 py-1.5 text-xs text-muted print:hidden">
            The local server is not running, so the library is unavailable. The board still works; start both with{' '}
            <kbd>pnpm dev</kbd>.
          </footer>
        )}
      </div>

      {palette && <CommandPalette screens={SCREENS} onClose={() => setPalette(false)} />}

      {ws.message && (
        <div
          role={ws.message.error ? 'alert' : 'status'}
          className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border bg-surface px-4 py-2 text-sm shadow-panel print:hidden ${
            ws.message.error ? 'border-danger text-danger' : 'border-line'
          }`}
        >
          {ws.message.text}
        </div>
      )}
    </div>
  );
}
