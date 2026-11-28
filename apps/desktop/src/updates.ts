import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { type UpdateStatus, type Updates, plainUpdateError } from '@chess/server/src/updates.ts';
import { type BrowserWindow, type MessageBoxOptions, app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Updates from the repository's GitHub releases. The app checks when it opens and every few hours,
 * downloads a new version in the background, then offers to restart into it; if put off, the update
 * installs itself when the app is closed. Settings shows where this stands (the server's update
 * routes read `status()`) and can check now or restart. Problems (offline, GitHub unreachable) never
 * interrupt: Settings says what went wrong, and updates.log in the data folder has the details.
 */

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LOG_LIMIT_BYTES = 256 * 1024;

export interface UpdateController extends Updates {
  /** Begins checking, once the window is there to offer the restart in. */
  start(getWindow: () => BrowserWindow | null): void;
}

export function createUpdates(): UpdateController {
  const version = app.getVersion();
  // Only the installed app knows where its updates come from (resources/app-update.yml).
  if (!app.isPackaged) return { version, status: () => ({ state: 'unavailable' }), check() {}, restart() {}, start() {} };

  const logFile = join(app.getPath('userData'), 'updates.log');
  const log = (level: string, message: unknown) => {
    try {
      if ((statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_LIMIT_BYTES) truncateSync(logFile, 0);
      appendFileSync(logFile, `${new Date().toISOString()} ${level} ${message instanceof Error ? message.message : String(message)}\n`);
    } catch {
      // Logging must never stop the app.
    }
  };

  autoUpdater.logger = {
    info: (message?: unknown) => log('info', message),
    warn: (message?: unknown) => log('warn', message),
    error: (message?: unknown) => log('error', message),
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let status: UpdateStatus = { state: 'idle' };
  let getWindow: () => BrowserWindow | null = () => null;
  const failed = (error: unknown) => {
    log('error', error);
    // A downloaded update stays ready whatever a later check says.
    if (status.state !== 'ready') status = { state: 'error', message: plainUpdateError(error), checkedAt: new Date().toISOString() };
  };

  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready' && status.state !== 'downloading') status = { state: 'checking' };
  });
  autoUpdater.on('update-not-available', () => {
    status = { state: 'up-to-date', checkedAt: new Date().toISOString() };
  });
  autoUpdater.on('update-available', (info) => {
    status = { state: 'downloading', version: info.version, percent: 0 };
  });
  autoUpdater.on('download-progress', (progress) => {
    if (status.state === 'downloading') status = { ...status, percent: Math.min(99, Math.floor(progress.percent)) };
  });
  let offered = false;
  autoUpdater.on('update-downloaded', async (info) => {
    status = { state: 'ready', version: info.version };
    if (offered) return;
    offered = true;
    const options: MessageBoxOptions = {
      type: 'info',
      title: 'Update ready',
      message: `Chess Workspace ${info.version} is ready.`,
      detail: 'Restart now to use it, or keep working: it installs by itself when you close the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const window = getWindow();
    const { response } = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
    // Silent install, then open the new version.
    if (response === 0) autoUpdater.quitAndInstall(true, true);
  });
  autoUpdater.on('error', failed);

  const check = () => {
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return;
    status = { state: 'checking' };
    autoUpdater.checkForUpdates().catch(failed);
  };

  return {
    version,
    status: () => status,
    check,
    restart: () => {
      if (status.state === 'ready') autoUpdater.quitAndInstall(true, true);
    },
    start: (windowGetter) => {
      getWindow = windowGetter;
      check();
      setInterval(check, CHECK_EVERY_MS).unref();
    },
  };
}
