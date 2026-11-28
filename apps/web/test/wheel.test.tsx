import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** The mouse wheel over a board steps through the moves: down a move on, up a move back. */

beforeEach(() => {
  window.location.hash = '#/board';
});

const frame = () => screen.getAllByTestId('board')[0]!.parentElement!;
const fen = () => (screen.getByLabelText('FEN') as HTMLInputElement).value;

function typeMoves(...moves: string[]) {
  const input = screen.getByLabelText('Type a move');
  for (const move of moves) {
    fireEvent.change(input, { target: { value: move } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }
}

describe('the wheel over the board', () => {
  it('steps back and on through the game, a notch at a time, and does not scroll the page', async () => {
    startServer();
    render(<App />);
    typeMoves('e4', 'e5', 'Nf3');
    await waitFor(() => expect(fen()).toContain('5N2'));

    const up = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
    frame().dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    await waitFor(() => expect(fen()).toBe('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'));

    // A trackpad's small scrolls add up to one move (50 pixels' worth).
    for (let i = 0; i < 3; i++) fireEvent.wheel(frame(), { deltaY: -15 });
    expect(fen()).toContain('4p3/4P3/8/');
    fireEvent.wheel(frame(), { deltaY: -15 });
    await waitFor(() => expect(fen()).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'));

    // Firefox counts lines: one is a notch.
    fireEvent.wheel(frame(), { deltaY: 3, deltaMode: 1 });
    await waitFor(() => expect(fen()).toContain('4p3/4P3/8/'));
  });

  it('moves along the line on the repertoire board', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } })).json();
    await app.inject({ method: 'POST', url: `/api/repertoires/${id}/line`, payload: { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', sans: ['d4', 'Nf6', 'c4'] } });
    window.location.hash = `#/repertoire/${id}`;
    render(<App />);
    await screen.findByRole('button', { name: /c4/ });
    const selected = () => screen.getByLabelText('Repertoire tree').querySelector('[data-selected="true"]')!.textContent;
    expect(selected()).toBe('Starting position');
    fireEvent.wheel(frame(), { deltaY: 100 });
    await waitFor(() => expect(selected()).toBe('1.d4'));
    fireEvent.wheel(frame(), { deltaY: 100 });
    fireEvent.wheel(frame(), { deltaY: 100 });
    await waitFor(() => expect(selected()).toBe('2.c4'));
    fireEvent.wheel(frame(), { deltaY: -100 });
    await waitFor(() => expect(selected()).toMatch(/Nf6/));
  });
});
