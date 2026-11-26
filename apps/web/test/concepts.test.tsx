import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

beforeEach(() => {
  window.location.hash = '#/board';
});

function go(hash: string) {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

describe('concepts', () => {
  it('creates a concept from the save box with just a title, and the page lists the position', async () => {
    const { app } = startServer();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.change(screen.getByLabelText('PGN or FEN'), { target: { value: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));

    fireEvent.keyDown(window, { key: 's' });
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Classic back rank' } });
    fireEvent.click(screen.getByText('More details (optional)…'));
    const picker = screen.getByLabelText('Link a concept');
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Back rank mate' } });
    fireEvent.click(await screen.findByText('+ Create “Back rank mate”'));
    await screen.findByRole('button', { name: 'Unlink Back rank mate' });
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await screen.findByText('Saved “Classic back rank”.');

    const [concept] = (await app.inject({ method: 'GET', url: '/api/concepts' })).json();
    expect(concept.title).toBe('Back rank mate');

    go(`#/concepts/${concept.id}`);
    expect(await screen.findByRole('heading', { name: 'Back rank mate' })).toBeTruthy();
    expect(await screen.findByText('Classic back rank')).toBeTruthy();
    expect(screen.getByText('Positions (1)')).toBeTruthy();

    // The drill hides the page until a move is played.
    fireEvent.click(screen.getByRole('button', { name: 'Drill' }));
    expect(await screen.findByText('The page stays hidden until you play a move.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Positions (1)')).toBeNull());
  });
});
