import { describe, expect, it, vi } from 'vitest';
import { openDatabase, runMigrations } from '../db/client.ts';
import { buildApp } from '../src/app.ts';
import { type UpdateStatus, plainUpdateError, updateRoutes } from '../src/updates.ts';

function appWith(status: UpdateStatus) {
  const { db } = openDatabase(':memory:');
  runMigrations(db);
  const app = buildApp(db);
  let test = false;
  const updates = {
    version: '0.1.35',
    status: () => status,
    check: vi.fn(),
    restart: vi.fn(),
    testVersions: () => test,
    setTestVersions: vi.fn((on: boolean) => (test = on)),
  };
  updateRoutes(app, updates);
  return { app, updates, set: (next: UpdateStatus) => (status = next) };
}

describe('update routes', () => {
  it('report the version and status, check on request, and restart only into a ready update', async () => {
    const { app, updates, set } = appWith({ state: 'idle' });
    expect((await app.inject({ method: 'GET', url: '/api/system/updates' })).json()).toEqual({ version: '0.1.35', status: { state: 'idle' }, testVersions: false });

    await app.inject({ method: 'POST', url: '/api/system/updates/check' });
    expect(updates.check).toHaveBeenCalledOnce();

    const early = await app.inject({ method: 'POST', url: '/api/system/updates/restart' });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toBe('No update is ready yet.');

    set({ state: 'ready', version: '0.1.36' });
    expect((await app.inject({ method: 'POST', url: '/api/system/updates/restart' })).statusCode).toBe(200);
    await vi.waitFor(() => expect(updates.restart).toHaveBeenCalledOnce());
    await app.close();
  });

  it('switch test versions on and off, and refuse anything but true or false', async () => {
    const { app, updates } = appWith({ state: 'up-to-date', checkedAt: '2026-11-28T10:00:00Z' });
    const on = await app.inject({ method: 'PUT', url: '/api/system/updates', payload: { testVersions: true } });
    expect(on.json().testVersions).toBe(true);
    expect(updates.setTestVersions).toHaveBeenCalledWith(true);
    expect((await app.inject({ method: 'PUT', url: '/api/system/updates', payload: { testVersions: 'yes' } })).statusCode).toBe(400);
    await app.close();
  });

  it('put updater errors in a sentence', () => {
    expect(plainUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe('GitHub could not be reached. Is the computer online?');
    expect(plainUpdateError(new Error('getaddrinfo ENOTFOUND api.github.com'))).toBe('GitHub could not be reached. Is the computer online?');
    expect(plainUpdateError(new Error('Cannot find latest.yml in the latest release\n  at headers: {...}'))).toBe('Cannot find latest.yml in the latest release');
    expect(plainUpdateError('x'.repeat(300))).toHaveLength(158);
  });
});
