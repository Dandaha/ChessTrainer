import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { EnginePanel } from '../src/components/EnginePanel.tsx';
import { startServer } from './server.ts';

/** Names already in use, the games screen's view kept between visits, and a drawn game end in the engine panel. */

beforeEach(() => {
  window.location.hash = '#/board';
});

function go(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

async function answer(title: string, text: string) {
  const input = await screen.findByRole('textbox', { name: title });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest('form')!);
}

describe('names already in use', () => {
  it('keeps the name box open with the reason, and takes another name there', async () => {
    startServer();
    render(<App />);
    go('#/positions');
    fireEvent.click(await screen.findByRole('button', { name: 'New set' }));
    await answer('New set', 'Lesson');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lesson' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'New set' }));
    await answer('New set', 'lesson');
    const dialog = await screen.findByRole('dialog', { name: 'New set' });
    expect((await within(dialog).findByRole('alert')).textContent).toBe('There is already a set called “Lesson”.');
    await answer('New set', 'Lesson two');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New set' })).toBeNull());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lesson two' })).toBeTruthy());
  });
});

describe('the games screen', () => {
  it('finds its filters as they were after a visit to another screen', async () => {
    startServer();
    render(<App />);
    go('#/games');
    fireEvent.change(await screen.findByLabelText('Player'), { target: { value: 'Carlsen' } });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '1-0' } });
    go('#/positions');
    await screen.findByRole('button', { name: 'New set' });
    go('#/games');
    await waitFor(() => expect((screen.getByLabelText('Player') as HTMLInputElement).value).toBe('Carlsen'));
    expect((screen.getByLabelText('Result') as HTMLSelectElement).value).toBe('1-0');
  });
});

describe('the engine panel at a game end', () => {
  const base = {
    settings: { lines: 1, depth: 20, elo: null },
    onSettings: () => {},
    threat: { on: false, side: 'Black' as const, onToggle: () => {} },
    onPlayLine: () => {},
    onTurnOff: () => {},
  };

  it('shows a repetition as 0.00 and the engine lines as what would follow', () => {
    const line = { multipv: 1, depth: 20, cp: 85, pv: ['e2e4'], san: ['e4'] };
    render(
      <EnginePanel
        {...base}
        state={{ analysis: { fen: '', engine: 'Stockfish', depth: 20, lines: [line] }, status: 'done', error: null }}
        gameOver={{ kind: 'threefold', result: '1/2-1/2' }}
      />,
    );
    const evaluation = screen.getByLabelText('Evaluation');
    expect(evaluation.textContent).toBe('0.00Draw by threefold repetition.');
    expect(screen.getByText('If the game goes on:')).toBeTruthy();
    expect(screen.getByText('+0.85')).toBeTruthy();
  });

  it('shows a mate as its result, without a second "game over" line', () => {
    render(
      <EnginePanel
        {...base}
        state={{ analysis: { fen: '', engine: 'Stockfish', depth: 0, lines: [] }, status: 'done', error: null }}
        gameOver={{ kind: 'checkmate', winner: 'white', result: '1-0' }}
      />,
    );
    expect(screen.getByLabelText('Evaluation').textContent).toBe('1-0Checkmate: White wins.');
    expect(screen.queryByText('If the game goes on:')).toBeNull();
    expect(screen.queryByText('No legal moves: the game is over.')).toBeNull();
  });
});
