import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown } from '../src/components/Markdown.tsx';
import { AskTextProvider } from '../src/components/AskText.tsx';
import { WorkspaceProvider } from '../src/workspace.tsx';

function show(text: string, fen?: string) {
  return render(
    <AskTextProvider>
      <WorkspaceProvider>
        <Markdown text={text} fen={fen} />
      </WorkspaceProvider>
    </AskTextProvider>,
  );
}

describe('notes in markdown', () => {
  it('turns a run of moves into a link, inside bold too', () => {
    show('After **1. Rd8#** it is over.', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    const link = screen.getByRole('button', { name: '1. Rd8#' });
    expect(link.closest('strong')).toBeTruthy();
    expect(document.body.textContent).toBe('After 1. Rd8# it is over.');
  });

  it('leaves moves that are illegal from the position as plain text', () => {
    show('Then 1. Qh5 wins.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws a board for a FEN line and never renders raw HTML', () => {
    show('# Lucena\n\n1k6/1P6/2K5/8/8/8/8/7R w - - 0 1\n\n<img src=x onerror=alert(1)>');
    expect(screen.getByRole('img', { name: 'Chess position' })).toBeTruthy();
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('reads moves written after a board from that board', () => {
    show('1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1\n\nAfter 1. Rd1+ Ke7 2. Rd4 the rook blocks the checks.');
    expect(screen.getByRole('button', { name: '1. Rd1+ Ke7 2. Rd4' })).toBeTruthy();
  });

  it('shows a line block after an unrelated board from the starting position', () => {
    show('1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1\n\n```line\n1. e4 e5 2. Nf3\n```');
    expect(screen.getByTitle('Open the line on the board')).toBeTruthy();
    expect(document.querySelector('pre')).toBeNull();
  });

  it('keeps a numbered list and the bullets after it apart', () => {
    show('1. Develop\n2. Castle\n- then attack\n- or not');
    expect(document.querySelectorAll('ol li')).toHaveLength(2);
    expect(document.querySelectorAll('ul li')).toHaveLength(2);
  });
});
