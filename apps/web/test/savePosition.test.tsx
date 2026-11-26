import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Saving a position takes one key and a title, and the save shows up everywhere. */

beforeEach(() => {
  window.location.hash = '#/board';
});

function openPgn(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.change(screen.getByLabelText('PGN or FEN'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
}

describe('saving a position', () => {
  it('saves with S and a title, then hints that it was saved before', async () => {
    startServer();
    render(<App />);
    openPgn('1. e4 e5 2. Nf3 Nc6 3. Bc4 *');

    fireEvent.keyDown(window, { key: 's' });
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Italian setup' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    expect(await screen.findByText('Saved “Italian setup”.')).toBeTruthy();

    // The same position again: the dialog says it was saved before.
    fireEvent.keyDown(window, { key: 's' });
    expect(await screen.findByText(/You saved this position before \(1\)/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Same position, other idea' } });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await screen.findByText('Saved “Same position, other idea”.');

    // Both saves are listed on the Positions screen.
    window.location.hash = '#/positions';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Italian setup' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Open Same position, other idea' })).toBeTruthy();
  });

  it('asks for nothing but a title', async () => {
    startServer();
    render(<App />);
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.submit((await screen.findByLabelText('Title')).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toBe('Give it a title.');
  });
});

describe('the game library', () => {
  it('imports pasted games and finds the ones that reached the board position', async () => {
    startServer();
    window.location.hash = '#/games';
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Import games' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'PGN' }), {
      target: {
        value: '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n\n[White "C"]\n[Black "D"]\n[Result "0-1"]\n\n1. Nf3 e5 2. e4 0-1\n',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Imported 2 games.')).toBeTruthy();
    await screen.findByText('A');

    // Open the first game and look at the position after 2.Nf3 / 2.e4: both games reached it.
    fireEvent.click(screen.getByText('A'));
    await screen.findByText('· in library');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('tab', { name: 'Games' }));
    expect(await screen.findByText('Reached in 2 games.')).toBeTruthy();
  });
});
