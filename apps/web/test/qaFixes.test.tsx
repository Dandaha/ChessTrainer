import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Fixes from the QA round: undo and the library link, the concept picker, no-move positions, unsaved edits. */

beforeEach(() => {
  window.location.hash = '#/board';
});

function go(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

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

describe('undo on a saved game', () => {
  it('keeps the game linked, so the next save updates it; undoing back to the save is clean', async () => {
    const { app } = startServer();
    render(<App />);
    await openPgn('[White "Undo"]\n[Black "Dup"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    // An opened game shows its start: to its end first.
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    play('Bb5');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('· in library');

    // A move after the save, undone: back to the saved game, linked and clean.
    play('a6');
    await screen.findByText('· unsaved changes');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await screen.findByText('· in library');

    // An undo past the save leaves it linked: the next save updates the same game.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await screen.findByText('· unsaved changes');
    play('Bc4');
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('Saved to the library.');
    const games = (await app.inject({ method: 'GET', url: '/api/games' })).json();
    expect(games.total).toBe(1);
    expect(games.games[0].white).toBe('Undo');
  });

  it('shows what the comment box holds after an undo', async () => {
    startServer();
    render(<App />);
    play('e4');
    const box = await screen.findByRole('textbox', { name: 'Comment' });
    fireEvent.change(box, { target: { value: 'My first comment' } });
    fireEvent.blur(box);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement).value).toBe(''));
  });
});

describe('the concept picker', () => {
  it('takes the concept with exactly the typed name on Enter, before others the search finds', async () => {
    const { app } = startServer();
    // "Decoy" sorts first and its text mentions forks; "Fork" is the one meant.
    await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Decoy', bodyMd: 'Lures a piece onto a fork square.' } });
    await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Fork' } });
    const { id } = (await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Windmill' } })).json();
    render(<App />);
    go(`#/concepts/${id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const picker = await screen.findByRole('combobox', { name: 'Link a concept' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'fork' } });
    await screen.findByRole('option', { name: /Fork/ });
    fireEvent.keyDown(picker, { key: 'Enter' });
    await screen.findByRole('button', { name: 'Unlink Fork' });
    expect(screen.queryByRole('button', { name: 'Unlink Decoy' })).toBeNull();
  });
});

describe('a saved position with no legal moves', () => {
  it('is passed over in solving, with the reason, instead of asking for a move', async () => {
    const { app } = startServer();
    const { id: setId } = (await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Ends' } })).json();
    await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: '4k3/4Q3/4K3/8/8/8/8/8 b - - 0 1', title: 'Mated', setIds: [setId] } });
    go(`#/training?set=${setId}`);
    render(<App />);
    expect(await screen.findByText('Nothing to find here: Checkmate: White wins.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Finish/ }));
    expect(await screen.findByRole('heading', { name: 'Right the first time.' })).toBeTruthy();
  });
});

describe('unsaved concept edits', () => {
  it('are not lost by going to another concept: it asks, and keeping them stays', async () => {
    const { app } = startServer();
    const a = (await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Alpha' } })).json();
    const b = (await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Beta' } })).json();
    render(<App />);
    go(`#/concepts/${a.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const body = await screen.findByLabelText(/Text/);
    fireEvent.change(body, { target: { value: 'Half-written notes' } });

    go(`#/concepts/${b.id}`);
    const question = await screen.findByRole('dialog', { name: 'Leave without saving?' });
    fireEvent.click(within(question).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/concepts/${a.id}`));
    expect((screen.getByLabelText(/Text/) as HTMLTextAreaElement).value).toBe('Half-written notes');

    go(`#/concepts/${b.id}`);
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByRole('heading', { name: 'Beta' })).toBeTruthy();
  });
});

describe('the games list', () => {
  const games = ['Anna', 'Bea', 'Cleo', 'Dora'].map((white, i) => `[White "${white}"]\n[Black "Z${i}"]\n[Result "1-0"]\n\n1. e4 e5 1-0\n`).join('\n');

  it('starts a new selection when the order changes, and drops a game deleted on its own', async () => {
    const { app } = startServer();
    await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: games } });
    render(<App />);
    go('#/games');
    const boxes = await screen.findAllByRole('checkbox', { name: 'Select game' });
    for (const box of boxes.slice(0, 3)) fireEvent.click(box);
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^White/ }));
    await waitFor(() => expect(screen.queryByText(/\d selected$/)).toBeNull());

    for (const box of screen.getAllByRole('checkbox', { name: 'Select game' }).slice(0, 2)) fireEvent.click(box);
    fireEvent.keyDown(screen.getAllByRole('row')[1]!, { key: 'Delete' });
    await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
  });

  it('keeps a dialog with typed text open on a click outside, and closes an untouched one', async () => {
    const { app } = startServer();
    await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn: games } });
    render(<App />);
    go('#/games');
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const notes = await screen.findByRole('textbox', { name: 'Notes' });
    await waitFor(() => expect((notes as HTMLTextAreaElement).disabled).toBe(false));
    const overlay = document.querySelector('[data-overlay]')!;
    fireEvent.input(notes, { target: { value: 'What I learnt' } });
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    await screen.findByRole('dialog');
    // A press inside let go outside (a text selection) does not close it either.
    fireEvent.pointerDown(screen.getByRole('textbox', { name: 'Notes' }));
    fireEvent.click(document.querySelector('[data-overlay]')!);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.querySelector('[data-overlay]')!);
    fireEvent.click(document.querySelector('[data-overlay]')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('redo on the board', () => {
  it('puts back what undo took back, and an ambiguous move names its choices', async () => {
    startServer();
    render(<App />);
    go('#/board');
    await screen.findByLabelText('Type a move');
    for (const move of ['d4', 'd5', 'Nf3', 'Nf6']) play(move);
    await waitFor(() => expect(screen.getAllByText('Nf6').length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.queryAllByText('Nf6')).toHaveLength(0));
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    await waitFor(() => expect(screen.getAllByText('Nf6').length).toBeGreaterThan(0));
    play('Nd2');
    expect(await screen.findByText('Nd2 could be Nbd2 or Nfd2: say which piece.')).toBeTruthy();
  });
});

describe('after a restart', () => {
  it('brings back a saved library game as saved, not with unsaved changes', async () => {
    const { writeDraft } = await import('../src/storage.ts');
    writeDraft(JSON.stringify({ pgn: '[White "Anna"]\n[Black "Bob"]\n\n1. e4 e5 *', linked: { id: 'g1', label: 'Anna – Bob' }, at: ['e4'], clean: true }));
    startServer();
    render(<App />);
    go('#/board');
    expect(await screen.findByText('· in library')).toBeTruthy();
    localStorage.clear();
  });
});
