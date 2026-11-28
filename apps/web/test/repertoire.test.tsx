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
    const created = await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } });
    const repertoireId = (created.json() as { id: string }).id;
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

    // The explorer writes a line without choices on one row, like a game score; mine in bold.
    go('#/repertoire');
    const tree = await screen.findByLabelText('Repertoire tree');
    await waitFor(() => expect(tree.querySelectorAll('[data-line]')).toHaveLength(1));
    expect(tree.querySelector('[data-line]')!.textContent).toBe('▾1.d4Nf62.c4e6');
    expect(screen.getByText('1.d4').className).toContain('font-semibold');

    // A second reply for Black after 2.c4: the line stops there and each reply gets its own row, indented.
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await app.inject({ method: 'POST', url: `/api/repertoires/${repertoireId}/line`, payload: { fen: START, sans: ['d4', 'Nf6', 'c4', 'g6'] } });
    go('#/board');
    await screen.findByLabelText('Type a move');
    go('#/repertoire');
    await waitFor(() => expect(screen.getByLabelText('Repertoire tree').querySelectorAll('[data-line]')).toHaveLength(3));
    const rows = [...screen.getByLabelText('Repertoire tree').querySelectorAll<HTMLElement>('[data-line]')];
    expect(rows.map((row) => [row.textContent, row.style.paddingLeft])).toEqual([
      ['▾1.d4Nf62.c4', '0px'],
      ['▾2...e6', '14px'],
      ['▾2...g6', '14px'],
    ]);
  });

  it('marks side moves of mine only: the opponent’s replies are all prepared alike, one listed first', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } })).json();
    const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    for (const sans of [['e4', 'e5'], ['e4', 'c5'], ['d4']]) {
      await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { fen: start, sans } });
    }
    go(`#/repertoire/${id}`);
    render(<App />);
    const tree = await screen.findByLabelText('Repertoire tree');
    const rows = () => [...tree.querySelectorAll('[data-line]')].map((l) => l.textContent);
    await waitFor(() => expect(rows()).toEqual(['▾1.e4', '▾1...e5', '▾1...c5', '▾1.d4side']));

    // A reply listed second can be moved to the top; my side move can be made the main one.
    fireEvent.click(screen.getByRole('button', { name: '1...c5' }));
    expect(screen.queryByRole('button', { name: 'Make main line' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to top' }));
    await waitFor(() => expect(rows()).toEqual(['▾1.e4', '▾1...c5', '▾1...e5', '▾1.d4side']));
    fireEvent.click(screen.getByRole('button', { name: '1.d4side' }));
    expect(await screen.findByRole('button', { name: 'Make main line' })).toBeTruthy();
  });
});
