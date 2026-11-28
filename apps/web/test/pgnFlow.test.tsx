import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';

beforeEach(() => {
  window.location.hash = '#/board';
});

/**
 * The phase 1 flow, end to end in the UI: paste a PGN, step through it, add a
 * sideline, export, and find the sideline in the PGN.
 */

const PGN = `[Event "Club game"]
[White "Me"]
[Black "Friend"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 { The Spanish. } a6 *`;

function moveButton(san: string) {
  return screen.getAllByRole('button').find((b) => b.dataset.node && b.textContent?.endsWith(san))!;
}

function openPgn(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.change(screen.getByLabelText('PGN or FEN'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
}

function exportedPgn(): string {
  fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  const value = (screen.getByLabelText('PGN') as HTMLTextAreaElement).value;
  fireEvent.keyDown(window, { key: 'Escape' });
  return value;
}

function typeMove(move: string) {
  const input = screen.getByLabelText('Type a move');
  fireEvent.change(input, { target: { value: move } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('PGN import and export', () => {
  it('keeps a sideline added on the board', () => {
    render(<App />);
    openPgn(PGN);
    expect(screen.getByText('The Spanish.')).toBeTruthy();

    // Step back from the start to Black's second move with the keyboard.
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(moveButton('Nc6').dataset.current).toBe('true');

    typeMove('Bc4');
    typeMove('bc5'); // lower case: the bishop, since no b-pawn can go to c5
    expect(moveButton('Bc5').dataset.current).toBe('true');

    const pgn = exportedPgn();
    expect(pgn).toContain('[White "Me"]');
    expect(pgn).toContain('3. Bb5 { The Spanish. } (3. Bc4 Bc5) 3... a6 *');
  });

  it('exports comments and NAGs written in the panel', () => {
    render(<App />);
    openPgn('1. e4 e5 2. Nf3 *');
    fireEvent.click(moveButton('Nf3'));
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Develops and attacks e5.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Good move' }));
    expect(exportedPgn()).toContain('2. Nf3! { Develops and attacks e5. } *');
  });

  it('promotes a sideline to the main line and undoes a delete', () => {
    render(<App />);
    openPgn('1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *');
    fireEvent.click(moveButton('c5'));
    fireEvent.click(screen.getByRole('button', { name: 'Make main line' }));
    expect(exportedPgn()).toContain('1. e4 c5 (1... e5 2. Nf3) 2. Nf3 *');

    fireEvent.click(moveButton('c5'));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(exportedPgn()).toContain('1. e4 e5 2. Nf3 *');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(exportedPgn()).toContain('1. e4 c5 (1... e5 2. Nf3) 2. Nf3 *');
  });

  it('opens a FEN pasted anywhere and refuses an illegal typed move', () => {
    render(<App />);
    const paste = new Event('paste', { bubbles: true }) as Event & { clipboardData: unknown };
    paste.clipboardData = { getData: () => '8/4P3/8/8/8/8/k7/4K3 w - - 0 1' };
    fireEvent(document.body, paste);
    typeMove('Ke2');
    typeMove('Qh8');
    expect(screen.getByRole('alert').textContent).toMatch(/Qh8 is not a legal move/);
    expect(exportedPgn()).toContain('[FEN "8/4P3/8/8/8/8/k7/4K3 w - - 0 1"]');
  });

  it('says when the game is over and can write the result into the PGN', () => {
    render(<App />);
    openPgn('1. f3 e5 2. g4 *');
    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.queryByText(/Checkmate/)).toBeNull();
    typeMove('Qh4');
    expect(screen.getByRole('status').textContent).toContain('Checkmate: Black wins.');
    fireEvent.click(screen.getByRole('button', { name: 'Set the result to 0-1' }));
    expect(exportedPgn()).toMatch(/\[Result "0-1"\][\s\S]*2\. g4 Qh4# 0-1/);
  });

  it('explains why a broken PGN does not load', () => {
    render(<App />);
    openPgn('1. e4 e5 2. Ke3');
    expect(screen.getByRole('alert').textContent).toMatch(/Line 1: 2\. Ke3 is not a legal move here/);
  });
});
