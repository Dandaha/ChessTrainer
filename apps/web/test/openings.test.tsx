import { mainlineFrom, parseGame } from '@chess/chess-core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Opening names from Lichess's table, on the analysis board, the repertoire and saved positions. */

const NAJDORF = '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

beforeEach(() => {
  window.location.hash = '#/board';
});

function typeMoves(...moves: string[]) {
  const input = screen.getByLabelText('Type a move');
  for (const move of moves) {
    fireEvent.change(input, { target: { value: move } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }
}

describe('opening names', () => {
  it('name the move on the analysis board, and none at the start', async () => {
    startServer();
    render(<App />);
    typeMoves('e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6');
    const label = await screen.findByLabelText('Opening');
    await waitFor(() => expect(label.textContent).toBe('B90 Sicilian Defense: Najdorf Variation'));
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.queryByLabelText('Opening')).toBeNull());
  });

  it('name the selected move of a repertoire, and each move in the tree', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { fen: START, sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] } });
    window.location.hash = `#/repertoire/${id}`;
    render(<App />);
    const bc4 = await screen.findByRole('button', { name: /Bc4/ });
    await waitFor(() => expect(bc4.title).toBe('C50 Italian Game'));
    fireEvent.click(bc4);
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Board display' })).getByTestId('opening').textContent).toBe('C50 Italian Game'));
  });

  it('name a saved position by the moves of its game, or by its own position', async () => {
    const { app } = startServer();
    const pgn = `[White "Me"]\n[Black "You"]\n\n${NAJDORF} 6. Be2 e5 7. Nb3 Be7 8. O-O O-O 9. Kh1 *`;
    await app.inject({ method: 'POST', url: '/api/games/import', payload: { pgn } });
    const [game] = (await app.inject({ method: 'GET', url: '/api/games' })).json().games;
    const deep = mainlineFrom(parseGame(pgn).root)[17]!.fen; // after 9.Kh1, out of the book
    const fromGame = (await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: deep, title: 'From the game', sourceGameId: game.id, sourcePly: 17 } })).json();
    const named = (await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: mainlineFrom(parseGame(`${NAJDORF} *`).root).at(-1)!.fen, title: 'Just the Najdorf' } })).json();
    const setUp = (await app.inject({ method: 'POST', url: '/api/saved-positions', payload: { fen: deep, title: 'Set up by hand' } })).json();

    const panelOpening = async (savedId: string, title: string) => {
      window.location.hash = `#/positions?open=${savedId}`;
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      const panel = await screen.findByRole('complementary', { name: 'Saved position' });
      await waitFor(() => expect((within(screen.getByRole('complementary', { name: 'Saved position' })).getByLabelText('Title') as HTMLInputElement).value).toBe(title));
      return screen.getByRole('complementary', { name: 'Saved position' });
    };
    render(<App />);
    let panel = await panelOpening(fromGame.id, 'From the game');
    await waitFor(() => expect(within(panel).getByTestId('opening').textContent).toMatch(/^B9\d Sicilian Defense: Najdorf Variation/));
    panel = await panelOpening(named.id, 'Just the Najdorf');
    await waitFor(() => expect(within(panel).getByTestId('opening').textContent).toBe('B90 Sicilian Defense: Najdorf Variation'));
    panel = await panelOpening(setUp.id, 'Set up by hand');
    expect(within(panel).queryByTestId('opening')).toBeNull();
  });
});
