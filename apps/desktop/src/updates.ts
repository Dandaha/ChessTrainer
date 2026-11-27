import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, type MessageBoxOptions, app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Updates from the repository's GitHub releases. The app checks when it opens and every few hours,
 * downloads a new version in the background, then offers to restart into it; if put off, the update
 * installs itself when the app is closed. Problems (offline, GitHub unreachable) never interrupt:
 * they are written to updates.log in the data folder.
 */

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const LOG_LIMIT_BYTES = 256 * 1024;

export function startUpdates(getWindow: () => BrowserWindow | null): void {
  // Only the installed app knows where its updates come from (resources/app-update.yml).
  if (!app.isPackaged) return;

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

  let offered = false;
  autoUpdater.on('update-downloaded', async (info) => {
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
  autoUpdater.on('error', (error) => log('error', error));

  const check = () => {
    autoUpdater.checkForUpdates().catch((error: unknown) => log('error', error));
  };
  check();
  setInterval(check, CHECK_EVERY_MS).unref();
}
