import { type ReactNode, useEffect, useRef, useState } from 'react';
import { SERVER_DOWN, api, useServerOnline } from './api.ts';
import { CommandPalette } from './components/CommandPalette.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { dialogOpen } from './Dialogs.tsx';
import { setLeaveQuestion, useRoute } from './router.ts';
import { BoardScreen, isTyping } from './screens/BoardScreen.tsx';
import { GamesScreen } from './screens/GamesScreen.tsx';
import { HomeScreen } from './screens/HomeScreen.tsx';
import { PositionsScreen } from './screens/PositionsScreen.tsx';
import { PresentScreen } from './screens/PresentScreen.tsx';
import { PrintScreen } from './screens/PrintScreen.tsx';
import { RepertoireScreen } from './screens/RepertoireScreen.tsx';
import { TrainingScreen } from './screens/TrainingScreen.tsx';
import { ConceptsScreen } from './screens/ConceptsScreen.tsx';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { applyTheme, useTheme } from './storage.ts';
import { WorkspaceProvider, useWorkspace } from './workspace.tsx';
import { AskTextProvider, useConfirm } from './components/AskText.tsx';
import { Icon, type IconName } from './components/icons.tsx';

export interface Screen {
  id: string;
  label: string;
  icon: IconName;
  render(): ReactNode;
}

const SCREENS: Screen[] = [
  { id: '', label: 'Home', icon: 'home', render: () => <HomeScreen /> },
  { id: 'board', label: 'Board', icon: 'board', render: () => <BoardScreen /> },
  { id: 'games', label: 'Games', icon: 'games', render: () => <GamesScreen /> },
  { id: 'positions', label: 'Positions', icon: 'positions', render: () => <PositionsScreen /> },
  { id: 'repertoire', label: 'Repertoire', icon: 'repertoire', render: () => <RepertoireScreen /> },
  { id: 'concepts', label: 'Concepts', icon: 'concepts', render: () => <ConceptsScreen /> },
  { id: 'training', label: 'Training', icon: 'training', render: () => <TrainingScreen /> },
  { id: 'settings', label: 'Settings', icon: 'settings', render: () => <SettingsScreen /> },
];

export function App() {
  return (
    <AskTextProvider>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </AskTextProvider>
  );
}

function Shell() {
  const ws = useWorkspace();
  const confirm = useConfirm();
  // Leaving a screen with unsaved work (router.ts) asks with the app's own dialog.
  useEffect(
    () =>
      setLeaveQuestion((message) =>
        confirm({ title: 'Leave without saving?', message, confirm: 'Discard changes', cancel: 'Keep editing' }),
      ),
    [confirm],
  );
  const route = useRoute();
  const theme = useTheme();
  const [palette, setPalette] = useState(false);
  const serverOnline = useServerOnline();
  const latest = useRef(ws);
  latest.current = ws;

  useEffect(() => {
    api.health().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
      }
      // Ctrl+Z undoes what the toast offers to undo (a delete), on every screen but the board, where
      // it takes back a move; never in a text field, where it undoes typing.
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        const action = latest.current.message?.action;
        if (action?.label !== 'Undo' || isTyping(event.target) || dialogOpen() || window.location.hash.startsWith('#/board')) return;
        event.preventDefault();
        latest.current.dismissMessage();
        void action.run();
      }
    };
    // A button clicked with the mouse lets go of the keyboard focus, so Space or Enter afterwards
    // does not press it again ("Delete from here" twice). Keyboard presses (detail 0) keep focus.
    const onClick = (event: MouseEvent) => {
      if (event.detail > 0) (event.target as Element | null)?.closest?.('button')?.blur();
    };
    document.addEventListener('click', onClick);

    // Paste a PGN or FEN anywhere (outside a text field) to open it on the board.
    const onPaste = (event: ClipboardEvent) => {
      if (isTyping(event.target) || document.querySelector('[role="dialog"]')) return;
      const text = event.clipboardData?.getData('text') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      void Promise.resolve(latest.current.openText(text)).then((problem) => problem && latest.current.toast(problem, true));
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  const toggleTheme = () => applyTheme(theme === 'dark' ? 'light' : 'dark');

  const [first = ''] = route.parts;
  const fullScreen = first === 'present' || first === 'print';
  const screen = SCREENS.find((s) => s.id === first) ?? SCREENS[0]!;

  return (
    <div className="flex h-full print:block print:h-auto">
      {!fullScreen && (
        <nav className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-surface py-3 xl:w-48 xl:items-stretch xl:px-2 print:hidden">
          <div className="mb-3 hidden items-center gap-2 whitespace-nowrap px-2 text-[15px] font-semibold tracking-tight xl:flex">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={24} height={24} className="rounded-md" />
            Chess Workspace
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
              <Icon name={s.icon} />
              <span className="hidden xl:inline">{s.label}</span>
            </a>
          ))}
          <div className="mt-auto space-y-1">
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="hidden w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-xs text-muted hover:bg-surface-2 xl:flex"
            >
              <Icon name="search" size={16} />
              <span>
                Jump to… <kbd>Ctrl</kbd> <kbd>K</kbd>
              </span>
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2"
            >
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
              <span className="hidden xl:inline">{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
            </button>
          </div>
        </nav>
      )}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <main className="min-h-0 flex-1 overflow-auto print:overflow-visible">
          <ErrorBoundary resetKey={route.parts.join('/')}>
            {first === 'present' && <PresentScreen setId={route.parts[1] ?? ''} />}
            {first === 'print' && <PrintScreen setId={route.parts[1] ?? ''} />}
            {!fullScreen && screen.render()}
          </ErrorBoundary>
        </main>
        {!serverOnline && !fullScreen && (
          <footer className="border-t border-line bg-surface px-4 py-1.5 text-xs text-muted print:hidden">
            The library is unavailable, but the board still works. {SERVER_DOWN}
          </footer>
        )}
      </div>

      {palette && <CommandPalette screens={SCREENS} onClose={() => setPalette(false)} />}

      {ws.message && (
        <div
          role={ws.message.error ? 'alert' : 'status'}
          className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-lg border bg-surface px-4 py-2 text-sm shadow-panel [overflow-wrap:anywhere] print:hidden ${
            ws.message.error ? 'border-danger text-danger' : 'border-line'
          }`}
        >
          {ws.message.text}
          {ws.message.action && (
            <button
              type="button"
              className="ml-3 font-semibold text-accent hover:underline"
              onClick={() => {
                const action = ws.message?.action;
                ws.dismissMessage();
                void action?.run();
              }}
            >
              {ws.message.action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
