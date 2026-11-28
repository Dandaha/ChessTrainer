import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Solving a set on demand: its positions in order, checked as in training, as practice only. */

beforeEach(() => {
  window.location.hash = '#/board';
  // No Stockfish: a position without an answer then has nothing to judge it.
  vi.stubEnv('STOCKFISH_PATH', '');
});

function type(move: string) {
  const input = screen.getByLabelText('Type your move');
  fireEvent.change(input, { target: { value: move } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';

describe('solving a set', () => {
  it('goes through the set, says how it went, and offers the missed positions again', async () => {
    const { app } = startServer();
    const { id: setId } = (await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Mates' } })).json();
    const save = (title: string, extra: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: BACK_RANK, title, setIds: [setId], ...extra } });
    await save('First', { answer: '1. Rd8#', inTraining: true });
    await save('Second', { answer: '1. Rd8#' });
    await save('No answer', {});
    render(<App />);

    window.location.hash = `#/positions?set=${setId}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    fireEvent.click(await screen.findByRole('button', { name: 'Solve' }));
    expect(await screen.findByText('Solving “Mates”')).toBeTruthy();
    expect(screen.getByText('Practice: your review schedule is not changed.')).toBeTruthy();

    // Right, then Next.
    await screen.findByRole('heading', { name: 'First' });
    type('Rd8#');
    expect(await screen.findByText('Right: Rd8# is your answer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Good/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Next/ }));

    // Wrong: Try again finds it, but it stays missed.
    await screen.findByRole('heading', { name: 'Second' });
    type('g3');
    expect(await screen.findByText('Your answer was 1. Rd8#; you played g3.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 't' });
    type('Rd8#');
    expect(await screen.findByText('Right this time: Rd8#.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });

    // No answer and no engine: I say whether I had it.
    await screen.findByRole('heading', { name: 'No answer' });
    type('g3');
    expect(await screen.findByText('Did you have it?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /I had it/ }));

    // The summary, and the missed one again.
    expect(await screen.findByRole('heading', { name: '2 of 3 right the first time.' })).toBeTruthy();
    expect(screen.getByRole('listitem').textContent).toBe('Second');
    fireEvent.click(screen.getByRole('button', { name: 'Again: the one missed' }));
    await screen.findByRole('heading', { name: 'Second' });
    type('Rd8#');
    await screen.findByText('Right: Rd8# is your answer.');
    fireEvent.click(screen.getByRole('button', { name: /^Finish/ }));
    expect(await screen.findByRole('heading', { name: 'Right the first time.' })).toBeTruthy();

    // Practice only: the position in training was not reviewed.
    const stats = (await app.inject({ method: 'GET', url: '/api/training/stats' })).json();
    expect(stats.positions.reviews).toBe(0);

    // Escape goes back to the set.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(window.location.hash).toBe(`#/positions?set=${setId}`));
    expect(await screen.findByRole('heading', { name: 'Mates' })).toBeTruthy();
  });

  it('stops part way with a summary of what was done, and an empty set says so', async () => {
    const { app } = startServer();
    const { id: setId } = (await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Two' } })).json();
    for (const title of ['A', 'B']) {
      await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: BACK_RANK, title, answer: 'Rd8#', setIds: [setId] } });
    }
    const { id: emptyId } = (await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Empty' } })).json();
    window.location.hash = `#/training?set=${setId}`;
    render(<App />);
    await screen.findByRole('heading', { name: 'A' });
    type('Rd8#');
    await screen.findByText('Right: Rd8# is your answer.');
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByRole('heading', { name: 'B' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('Stopped after 1 of 2 positions.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '1 of 1 right the first time.' })).toBeTruthy();

    window.location.hash = `#/training?set=${emptyId}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await screen.findByText('This set has no positions to solve yet.')).toBeTruthy();
  });
});
