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

    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
    expect(screen.getByText(/2 new to learn/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start training' }));

    // Card 1, new: after 1.e4 the board shows my move (learn mode) and I play it.
    await screen.findByText('New move: play c5', {}, { timeout: 3000 });
    type('c5');
    expect(await screen.findByText('Learned: c5. It comes back for review soon.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });

    // Card 2: after 1.e4 c5 2.Nf3, my move is d6; e6 is not it.
    await screen.findByText('1.e4 c5 2.Nf3');
    await screen.findByText('New move: play d6', {}, { timeout: 3000 });
    type('e6');
    expect(await screen.findByText('Your repertoire plays d6 here, not e6.')).toBeTruthy();
    fireEvent.keyDown(window, { key: '1' });

    // Graded Again, the card comes back at the end of the session, now without help.
    expect(await screen.findByText('3 / 3 · 1 right')).toBeTruthy();
    await screen.findByText('Your move', {}, { timeout: 3000 });
    type('d6');
    expect(await screen.findByText('Right: d6.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });

    // Back on the overview; the stats count the three answers, two right.
    expect(await screen.findByText('Missed most often')).toBeTruthy();
    const stats = (await app.inject({ method: 'GET', url: '/api/training/stats' })).json();
    expect(stats.byRepertoire[0]).toMatchObject({ cards: 2, reviews: 3 });
    expect(stats.byRepertoire[0].accuracy).toBeCloseTo(2 / 3);
  });

  it('lets me try again after a miss, which still counts as missed', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Sicilian', color: 'black' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4', 'c5'] } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start training' }));

    await screen.findByText('New move: play c5', {}, { timeout: 3000 });
    type('e5');
    expect(await screen.findByText('Your repertoire plays c5 here, not e5.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    type('c5');
    expect(await screen.findByText('Right this time: c5.')).toBeTruthy();
    // The highlighted grade is Again, and the review is stored as a miss.
    expect(screen.getByRole('button', { name: /Again/ }).className).toContain('bg-accent');
    fireEvent.keyDown(window, { key: 'Enter' });
    // Asked again at the end of the session.
    await screen.findByText('Your move', {}, { timeout: 3000 });
    type('c5');
    expect(await screen.findByText('Right: c5.')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('Missed most often')).toBeTruthy();
    const stats = (await app.inject({ method: 'GET', url: '/api/training/stats' })).json();
    expect(stats.byRepertoire[0]).toMatchObject({ reviews: 2, accuracy: 0.5 });
  });

  it('shows the solution of a saved position after a miss', async () => {
    const { app } = startServer();
    await app.inject({
      method: 'POST',
      url: '/api/saved-positions',
      payload: { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', title: 'Back rank', answer: '1. Rd8#', inTraining: true },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start training' }));
    await screen.findByText('Back rank');
    type('g3');
    expect(await screen.findByText('Your answer was 1. Rd8#; you played g3.')).toBeTruthy();
    expect(screen.queryByText('Answer: 1. Rd8#')).toBeNull();
    fireEvent.keyDown(window, { key: 's' });
    expect(await screen.findByText('Answer: 1. Rd8#')).toBeTruthy();
  });
});

describe('grading', () => {
  it('records one review for a card however many times the grade is pressed', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Sicilian', color: 'black' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4', 'c5', 'Nf3', 'd6'] } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start training' }));
    await screen.findByText('New move: play c5', {}, { timeout: 3000 });
    type('c5');
    await screen.findByText('Learned: c5. It comes back for review soon.');
    // Pressed twice before the next card shows.
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('2 / 2 · 1 right')).toBeTruthy();
    const stats = (await app.inject({ method: 'GET', url: '/api/training/stats' })).json();
    expect(stats.byRepertoire[0]).toMatchObject({ reviews: 1 });
  });
});

describe('not knowing the move', () => {
  it('offers a hint and the answer on a review, and the answer counts as missed', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Sicilian', color: 'black' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { sans: ['e4', 'c5'] } });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start training' }));
    await screen.findByText('New move: play c5', {}, { timeout: 3000 });
    // Learning shows the move already: no hint or answer buttons.
    expect(screen.queryByRole('button', { name: 'Show answer' })).toBeNull();
    type('c5');
    await screen.findByText('Learned: c5. It comes back for review soon.');
    fireEvent.keyDown(window, { key: '1' });
    // Asked again, now as a review.
    await screen.findByText('Your move', {}, { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
    expect((screen.getByRole('button', { name: 'Hint' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    expect(await screen.findByText('The move is c5.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Again/ }).className).toContain('bg-accent');
  });
});
