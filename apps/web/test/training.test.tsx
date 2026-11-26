import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** The repertoire drill: the app plays the line, I find my move, the card is graded. */

beforeEach(() => {
  window.location.hash = '#/training';
});

function type(move: string) {
  const input = screen.getByLabelText('Type your move');
  fireEvent.change(input, { target: { value: move } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('training', () => {
  it('drills my repertoire moves and records the answers', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Sicilian', color: 'black' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4', 'c5', 'Nf3', 'd6'] } });
    render(<App />);

    expect(await screen.findByText(/0 repertoire cards and 0 positions due today/)).toBeTruthy();
    expect(screen.getByText(/plus 2 new/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Train everything due' }));

    // Card 1: after 1.e4, my move is c5.
    await screen.findByText('Your move', {}, { timeout: 3000 });
    type('c5');
    expect(await screen.findByText('Right: c5.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });

    // Card 2: after 1.e4 c5 2.Nf3, my move is d6; e6 is not it.
    await screen.findByText('1.e4 1...c5 2.Nf3');
    await screen.findByText('Your move', {}, { timeout: 3000 });
    type('e6');
    expect(await screen.findByText('Your repertoire plays d6 here, not e6.')).toBeTruthy();
    fireEvent.keyDown(window, { key: '1' });

    // Back on the overview; the stats count both answers, one right.
    expect(await screen.findByText('Weakest lines')).toBeTruthy();
    const stats = (await app.inject({ method: 'GET', url: '/api/training/stats' })).json();
    expect(stats.byRepertoire[0]).toMatchObject({ cards: 2, reviews: 2, accuracy: 0.5 });
  });
});
