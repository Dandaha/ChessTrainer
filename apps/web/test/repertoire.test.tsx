import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Adding moves to a repertoire from the board, and seeing them in the explorer. */

beforeEach(() => {
  window.location.hash = '#/board';
});

function go(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function typeMoves(...moves: string[]) {
  const input = screen.getByLabelText('Type a move');
  for (const move of moves) {
    fireEvent.change(input, { target: { value: move } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }
}

describe('the repertoire', () => {
  it('adds the line on the board with R, shows it in the explorer, and checks a game against it', async () => {
    const { app } = startServer();
    await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } });
    render(<App />);

    typeMoves('d4', 'Nf6', 'c4', 'e6');
    fireEvent.keyDown(window, { key: 'r' });
    expect(await screen.findByText(/1\.d4 1\.\.\.Nf6 2\.c4 2\.\.\.e6/)).toBeTruthy();
    fireEvent.submit((await screen.findByRole('radio')).closest('form')!);
    expect(await screen.findByText('Added 4 moves to “Main”.')).toBeTruthy();

    // A different 2nd move for White on the board: the Repertoire tab says where we left it.
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    typeMoves('d4', 'Nf6', 'Nf3');
    fireEvent.click(screen.getByRole('tab', { name: 'Repertoire' }));
    expect(await screen.findByText(/You left your preparation on move 2 with Nf3; your line is c4\./)).toBeTruthy();

    // The explorer lists the moves, mine in bold.
    go('#/repertoire');
    const tree = await screen.findByLabelText('Repertoire tree');
    await waitFor(() => expect(tree.textContent).toContain('2...e6'));
    expect(tree.textContent).toContain('1.d4');
    expect(screen.getByText('1.d4').className).toContain('font-semibold');
  });
});
