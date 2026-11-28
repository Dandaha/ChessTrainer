import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Setting up a position by hand on the Positions screen, then everything to know about it. */

beforeEach(() => {
  window.location.hash = '#/positions';
});

describe('a new position', () => {
  it('is set up on a board, described in full, and can go back to the board without losing the details', async () => {
    const { app } = startServer();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'New position' }));

    // The board: a FEN pasted in, then castling, the move number and the 50-move count changed.
    const editor = await screen.findByRole('dialog', { name: 'Set up a position' });
    const fen = within(editor).getByLabelText('Editor FEN');
    fireEvent.change(fen, { target: { value: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 23' } });
    fireEvent.keyDown(fen, { key: 'Enter' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Black O-O-O' }));
    // The counters are folded away, their values in the heading.
    const advanced = within(editor).getByText(/^Advanced:/);
    expect(advanced.textContent).toBe('Advanced: move 23, 0 since a capture or pawn move');
    expect(advanced.closest('details')!.open).toBe(false);
    fireEvent.click(advanced);
    fireEvent.change(within(editor).getByLabelText('Move number'), { target: { value: '31' } });
    fireEvent.change(within(editor).getByLabelText('Halfmove clock'), { target: { value: '7' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Next: its details' }));

    // The details, all open, with the position shown in words.
    const details = await screen.findByRole('dialog', { name: 'New position' });
    expect(within(details).getByTestId('setup-summary').textContent).toBe(
      'White to move · castling: White O-O, White O-O-O, Black O-O · move 31 · 7 moves since a capture or pawn move',
    );
    fireEvent.change(within(details).getByLabelText('Title'), { target: { value: 'Rook ending idea' } });
    fireEvent.change(within(details).getByLabelText('Tags'), { target: { value: 'rooks, castling' } });
    fireEvent.change(within(details).getByLabelText('Notes'), { target: { value: 'Watch the h-file.' } });

    // Back to the board to make it Black's move; what was typed is still there.
    fireEvent.click(within(details).getByRole('button', { name: '← Change the position' }));
    const again = await screen.findByRole('dialog', { name: 'Set up a position' });
    expect((within(again).getByLabelText('Editor FEN') as HTMLInputElement).value).toBe('r3k2r/8/8/8/8/8/8/R3K2R w KQk - 7 31');
    fireEvent.click(within(again).getByRole('radio', { name: 'Black' }));
    fireEvent.click(within(again).getByRole('button', { name: 'Next: its details' }));
    const back = await screen.findByRole('dialog', { name: 'New position' });
    expect(within(back).getByTestId('setup-summary').textContent).toMatch(/^Black to move/);
    expect((within(back).getByLabelText('Title') as HTMLInputElement).value).toBe('Rook ending idea');

    fireEvent.submit(within(back).getByLabelText('Title').closest('form')!);
    expect(await screen.findByText('Saved “Rook ending idea”.')).toBeTruthy();
    const { positions } = (await app.inject({ method: 'GET', url: '/api/saved-positions' })).json();
    expect(positions[0]).toMatchObject({
      title: 'Rook ending idea',
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R b KQk - 7 31',
      sideToSolve: 'black',
      tags: ['castling', 'rooks'],
      notesMd: 'Watch the h-file.',
    });
    // It opens beside the list.
    const panel = await screen.findByRole('complementary', { name: 'Saved position' });
    await waitFor(() => expect((within(panel).getByLabelText('Title') as HTMLInputElement).value).toBe('Rook ending idea'));
  });

  it('starts in the set on screen', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/sets', payload: { name: 'Endings' } })).json();
    window.location.hash = `#/positions?set=${id}`;
    render(<App />);
    await screen.findByRole('heading', { name: 'Endings' });
    fireEvent.click(screen.getByRole('button', { name: 'New position' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Set up a position' })).getByRole('button', { name: 'Next: its details' }));
    const details = await screen.findByRole('dialog', { name: 'New position' });
    expect((within(details).getByLabelText('Set') as HTMLSelectElement).value).toBe(id);
  });
});
