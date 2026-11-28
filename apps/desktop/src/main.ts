import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, Menu, app, shell } from 'electron';
import { startLocalServer } from './localServer.ts';
import { createUpdates } from './updates.ts';

/**
 * The Electron main process: starts the app's local server and shows it in a
 * window. The pages are the same as in the browser version.
 */

const here = dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let server: Awaited<ReturnType<typeof startLocalServer>> | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const resources = app.isPackaged ? process.resourcesPath : join(here, '..');
    const updates = createUpdates();
    try {
      server = await startLocalServer({
        dataDir: app.getPath('userData'),
        webDir: join(here, 'web'),
        stockfishDir: join(resources, 'stockfish'),
        mcp: { command: process.execPath, script: join(here, 'mcp.mjs'), env: { ELECTRON_RUN_AS_NODE: '1' } },
        updates,
        openFolder: (path) => shell.openPath(path),
      });
      rmSync(join(app.getPath('userData'), 'startup-error.txt'), { force: true });
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      // Also kept in the data folder, where the CI check (and a screenshot-less bug report) can read it.
      try {
        writeFileSync(join(app.getPath('userData'), 'startup-error.txt'), `${new Date().toISOString()}\n${message}\n`);
      } catch {
        // The data folder itself may be the problem.
      }
      const { dialog } = await import('electron');
      dialog.showErrorBox('Chess Workspace could not start', message);
      app.quit();
      return;
    }

    window = new BrowserWindow({
      width: 1440,
      height: 920,
      minWidth: 960,
      minHeight: 640,
      title: 'Chess Workspace',
      backgroundColor: '#f4f2ee',
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true },
    });
    window.once('ready-to-show', () => window?.show());

    // Links to other sites (Lichess, the Claude Console...) open in the normal browser.
    const local = server.url;
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(local)) {
        event.preventDefault();
        if (/^https?:/.test(url)) void shell.openExternal(url);
      }
    });
    // F12 opens the developer tools, Ctrl+R reloads: handy when something looks wrong.
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') window?.webContents.toggleDevTools();
      if ((input.control || input.meta) && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        window?.webContents.reload();
      }
      // Ctrl+= / Ctrl+- / Ctrl+0 zoom, as in a browser (the app has no menu, which would give them).
      if (input.control || input.meta) {
        const contents = window?.webContents;
        if (!contents) return;
        const zoom = contents.getZoomLevel();
        if (input.key === '=' || input.key === '+') {
          event.preventDefault();
          contents.setZoomLevel(Math.min(zoom + 0.5, 4));
        } else if (input.key === '-') {
          event.preventDefault();
          contents.setZoomLevel(Math.max(zoom - 0.5, -3));
        } else if (input.key === '0') {
          event.preventDefault();
          contents.setZoomLevel(0);
        }
      }
    });

    await window.loadURL(local);
    updates.start(() => window);
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', (event) => {
    if (!server) return;
    event.preventDefault();
    const closing = server;
    server = null;
    void closing.close().finally(() => app.quit());
  });
}
