import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** The material strips at the analysis board's edges: what each side is up, and by how much. */

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

const strips = () => screen.getAllByTestId(/^material-/).map((s) => s.dataset.testid);

describe('the material strips', () => {
  it('show a captured pawn and the lead, level again after the recapture, each side at its edge', async () => {
    startServer();
    render(<App />);
    // Black at the top, White at the bottom, nothing to show yet.
    expect(strips()).toEqual(['material-black', 'material-white']);
    expect(screen.getByTestId('material-white').getAttribute('aria-label')).toBeNull();

    typeMoves('e4', 'd5', 'exd5');
    await waitFor(() => expect(screen.getByTestId('material-white').getAttribute('aria-label')).toBe('White +1: up 1 pawn'));
    expect(screen.getByTestId('material-white').querySelectorAll('img')).toHaveLength(1);
    expect(screen.getByTestId('material-white').textContent).toBe('+1');
    expect(screen.getByTestId('material-black').getAttribute('aria-label')).toBeNull();

    typeMoves('Qxd5');
    await waitFor(() => expect(screen.getByTestId('material-white').getAttribute('aria-label')).toBeNull());

    // Flipped, the strips change edges with the board.
    fireEvent.keyDown(window, { key: 'f' });
    await waitFor(() => expect(strips()).toEqual(['material-white', 'material-black']));
  });
});
