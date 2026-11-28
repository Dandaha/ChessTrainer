import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** The repertoire board's switches: the engine's lines and arrow, and the repertoire's own arrows. */

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** A stand-in for the engine's stream: from the starting position it answers 1.Nf3 Nc6 at +0.30. */
class FakeEngineStream {
  private listeners = new Map<string, (event: MessageEvent) => void>();
  constructor(url: string) {
    const fen = new URL(url, 'http://localhost').searchParams.get('fen');
    if (fen !== START) return;
    setTimeout(() => {
      const analysis = { fen, engine: 'Stockfish', depth: 20, lines: [{ multipv: 1, depth: 20, cp: 30, pv: ['g1f3', 'b8c6'], san: ['Nf3', 'Nc6'] }] };
      this.listeners.get('done')?.(new MessageEvent('done', { data: JSON.stringify(analysis) }));
    }, 0);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }
  close() {}
}

beforeEach(() => {
  window.location.hash = '#/board';
});

const switchFor = (name: RegExp) => screen.getByRole('button', { name });
const pressed = (name: RegExp) => switchFor(name).getAttribute('aria-pressed');
const treeText = () => [...screen.getByLabelText('Repertoire tree').querySelectorAll('[data-line]')].map((l) => l.textContent);

describe('the repertoire board with the engine', () => {
  it('shows the engine on request and adds its moves and lines to the repertoire', async () => {
    const { app } = startServer();
    vi.stubGlobal('EventSource', FakeEngineStream);
    await app.inject({ method: 'POST', url: '/api/repertoires', payload: { name: 'Main', color: 'white' } });
    window.location.hash = '#/repertoire';
    render(<App />);

    // Off at first, apart from the repertoire's own arrows.
    await screen.findByRole('group', { name: 'Board display' });
    expect([pressed(/^Engine lines/), pressed(/^Best-move arrow/), pressed(/^Variation arrows/)]).toEqual(['false', 'false', 'true']);

    // E shows the lines; the choice is kept for next time.
    fireEvent.keyDown(window, { key: 'e' });
    expect(pressed(/^Engine lines/)).toBe('true');
    expect(localStorage.getItem('chess-workspace:repertoire-engine-lines')).toBe('1');
    const panel = await screen.findByLabelText('Engine lines', { selector: 'div' });
    expect(await within(panel).findByText('+0.30')).toBeTruthy();
    expect(within(panel).getByText(/adds the top line's first move/)).toBeTruthy();

    // Space adds the engine's move here.
    fireEvent.keyDown(window, { key: ' ' });
    await waitFor(() => expect(treeText()).toEqual(['▾1.Nf3']));

    // From the start again, a click on a move of a line adds the line up to it.
    fireEvent.keyDown(window, { key: 'Home' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Nc6' }));
    expect(await screen.findByText('Added 1.Nf3 Nc6.')).toBeTruthy();
    await waitFor(() => expect(treeText()).toEqual(['▾1.Nf3Nc6']));

    // A and V switch the arrows; E again hides the lines.
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'v' });
    expect([pressed(/^Best-move arrow/), pressed(/^Variation arrows/)]).toEqual(['true', 'false']);
    expect(localStorage.getItem('chess-workspace:repertoire-move-arrows')).toBe('0');
    fireEvent.click(switchFor(/^Engine lines/));
    await waitFor(() => expect(screen.queryByLabelText('Engine lines', { selector: 'div' })).toBeNull());
  });
});
