import type { UpdateStatus } from '@chess/server/src/updates.ts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Settings shows the installed app's version and where its updates stand. */

beforeEach(() => {
  window.location.hash = '#/settings';
});

function fakeUpdates(first: UpdateStatus) {
  let status = first;
  return {
    set: (next: UpdateStatus) => (status = next),
    updates: {
      version: '0.1.35',
      status: () => status,
      check: vi.fn(() => (status = { state: 'downloading', version: '0.1.36', percent: 45 })),
      restart: vi.fn(),
    },
  };
}

describe('the Updates section', () => {
  it('follows a check through the download to a restart', async () => {
    const fake = fakeUpdates({ state: 'up-to-date', checkedAt: new Date().toISOString() });
    startServer({ updates: fake.updates });
    render(<App />);
    expect(await screen.findByText('Chess Workspace 0.1.35')).toBeTruthy();
    expect(screen.getByText(/Up to date\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(await screen.findByText('Downloading 0.1.36… 45%')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Update download' }).getAttribute('aria-valuenow')).toBe('45');
    expect(fake.updates.check).toHaveBeenCalledOnce();

    // While downloading the section looks again every second.
    fake.set({ state: 'ready', version: '0.1.36' });
    expect(await screen.findByText('Version 0.1.36 is ready.', undefined, { timeout: 3000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }));
    await waitFor(() => expect(fake.updates.restart).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Restarting…' })).toBeTruthy();
  });

  it('says why a check failed and offers to try again', async () => {
    const fake = fakeUpdates({ state: 'error', message: 'GitHub could not be reached. Is the computer online?', checkedAt: new Date().toISOString() });
    startServer({ updates: fake.updates });
    render(<App />);
    expect(await screen.findByText('Couldn’t check for updates: GitHub could not be reached. Is the computer online?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fake.updates.check).toHaveBeenCalledOnce());
  });

  it('is not there in the browser version', async () => {
    startServer();
    render(<App />);
    await screen.findByRole('heading', { name: 'Backups' });
    expect(screen.queryByRole('heading', { name: 'Updates' })).toBeNull();
  });
});
