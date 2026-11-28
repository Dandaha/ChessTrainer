import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Work on the board is never replaced silently, and undo brings back the library game, not a copy. */

beforeEach(() => {
  window.location.hash = '#/board';
});

async function openPgn(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'PGN or FEN' }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

function play(move: string) {
  const input = screen.getByLabelText('Type a move');
  fireEvent.change(input, { target: { value: move } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const movesShown = () => screen.queryAllByText(/Nf3/).length > 0;

describe('unsaved work on the board', () => {
  it('asks before New replaces edits, and undo restores the library game it came from', async () => {
    const { app } = startServer();
    render(<App />);

    // An analysis, even edited, goes without a question, with a note that Ctrl+Z brings it back.
    await openPgn('[White "Dave"]\n[Black "Friend"]\n\n1. e4 e5 *');
    play('Nf3');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() => expect(movesShown()).toBe(false));
    expect(screen.queryByRole('dialog', { name: 'Discard the changes?' })).toBeNull();
    expect(screen.getByText('The previous analysis is cleared. Ctrl+Z brings it back.')).toBeTruthy();

    // Save a game to the library, then edit it: New asks, and "Keep editing" keeps the move.
    await openPgn('[White "Dave"]\n[Black "Friend"]\n\n1. e4 e5 *');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('· in library');
    play('Nf3');
    await screen.findByText('· unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(movesShown()).toBe(true);

    // "Discard changes" clears the board; Ctrl+Z brings the game back with its library link.
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(movesShown()).toBe(false));
    expect(screen.getByText('Analysis')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(movesShown()).toBe(true));
    expect(screen.getByText(/^Dave – Friend, \d{4}$/)).toBeTruthy();

    // Saving now updates that game rather than adding a second copy.
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('Saved to the library.');
    const games = (await app.inject({ method: 'GET', url: '/api/games' })).json();
    expect(games.total).toBe(1);
  });

  it('counts stepping into a move already there as navigation, and saves with Ctrl+S from the comment box', async () => {
    const { app } = startServer();
    render(<App />);
    await openPgn('[White "Dave"]\n[Black "Friend"]\n\n1. e4 e5 2. Nf3 *');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('· in library');
    fireEvent.keyDown(window, { key: 'Home' });
    play('e4');
    play('e5');
    expect(screen.getByText('· in library')).toBeTruthy();

    play('Bc4');
    await screen.findByText('· unsaved changes');
    const comment = screen.getByLabelText(/Comment/);
    fireEvent.keyDown(comment, { key: 's', ctrlKey: true });
    await screen.findByText('Saved to the library.');
    expect((await app.inject({ method: 'GET', url: '/api/games' })).json().total).toBe(1);
  });
});
