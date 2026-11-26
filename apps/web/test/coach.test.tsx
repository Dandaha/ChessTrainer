import type { StreamingClient } from '@chess/server/coach/coach.ts';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** The coach tab on the board, with a stand-in for the Claude API. */

beforeEach(() => {
  window.location.hash = '#/board';
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

function openFen(fen: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.change(screen.getByLabelText('PGN or FEN'), { target: { value: fen } });
  fireEvent.click(screen.getByRole('button', { name: 'Load' }));
}

function fakeClaude(): StreamingClient {
  const replies = [
    {
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'b1',
          name: 'show_on_board',
          input: { arrows: [{ from: 'd1', to: 'd8', color: 'green' }], lines: [{ label: 'Mate', moves: ['Rd8#'] }] },
        },
      ],
    },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: '**Rd8#** is mate: the king is boxed in by its own pawns.' }] },
  ];
  let n = 0;
  return {
    stream(params) {
      const reply = replies[n++]!;
      const listeners: ((d: string) => void)[] = [];
      return {
        on(_e, l) {
          listeners.push(l);
          return this;
        },
        async finalMessage() {
          for (const b of reply.content as { type: string; text?: string }[]) if (b.type === 'text') listeners.forEach((l) => l(String(b.text)));
          return { model: params.model, content: reply.content, stop_reason: reply.stop_reason, usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 } } as never;
        },
      };
    },
  };
}

describe('the coach on the board', () => {
  it('says how to connect it when there is no API key', async () => {
    startServer();
    render(<App />);
    fireEvent.keyDown(window, { key: 'c' });
    expect(await screen.findByText('Coach not connected - add an API key in Settings')).toBeTruthy();
  });

  it('answers a question with lines to click and shows the tokens used', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-for-the-stand-in-client';
    startServer({ coachClient: fakeClaude() });
    render(<App />);
    openFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    fireEvent.keyDown(window, { key: 'c' });
    const box = await screen.findByLabelText('Ask the coach');
    fireEvent.change(box, { target: { value: 'What should White play?' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    expect(await screen.findByText(/is mate: the king is boxed in/)).toBeTruthy();
    expect(screen.getByText(/Haiku 5\.5 · 6,600 tokens in \(5,000 from cache\) · 240 out/)).toBeTruthy();
    // The line plays on the board.
    fireEvent.click(screen.getByRole('button', { name: /Mate: Rd8#/ }));
    expect(screen.getAllByRole('button').some((b) => b.dataset.node && b.textContent === '1.Rd8#')).toBe(true);
    // The answer stays, marked as being about the position before.
    expect(screen.getByText(/is mate: the king is boxed in/)).toBeTruthy();
    expect(screen.getByText('This answer is about an earlier position.')).toBeTruthy();
  });
});
