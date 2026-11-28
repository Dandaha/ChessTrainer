import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('files concepts under the person’s own categories: a new one from the editor, a filter, a rename', async () => {
    const { app } = startServer();
    const { id } = (await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Arabian mate' } })).json();
    await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Fork', category: 'Tactical motifs' } });
    render(<App />);
    go(`#/concepts/${id}`);

    // A new category, made from the editor's picker.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const picker = await screen.findByLabelText('Category');
    fireEvent.change(picker, { target: { value: [...(picker as HTMLSelectElement).options].at(-1)!.value } });
    fireEvent.change(await screen.findByRole('textbox', { name: 'New category' }), { target: { value: 'Checkmate patterns' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'New category' }).closest('form')!);
    await waitFor(() => expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('Checkmate patterns'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The list groups by it, and the category list filters to it.
    const side = await screen.findByRole('button', { name: /^Checkmate patterns\s*1/ });
    // The concept list reloads a moment later than the category list.
    expect(await screen.findByText('Tactical motifs', { selector: 'div' })).toBeTruthy();
    fireEvent.click(side);
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Fork' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Arabian mate' })).toBeTruthy();

    // Renamed, it is renamed on the concept too.
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Rename category' }), { target: { value: 'Mating patterns' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Rename category' }).closest('form')!);
    await waitFor(async () => expect((await app.inject({ method: 'GET', url: `/api/concepts/${id}` })).json().category).toBe('Mating patterns'));
    expect(await screen.findByRole('button', { name: /^Mating patterns\s*1/ })).toBeTruthy();
    expect(within(screen.getByRole('main')).getAllByText(/Mating patterns/).length).toBeGreaterThan(0);
  });

  it('fills the library with the starter concepts on request, and only once', async () => {
    startServer();
    render(<App />);
    go('#/concepts');
    expect(await screen.findByText(/Your chess wiki is empty/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Add \d+ missing starter concepts$/ }));
    expect(await screen.findByText(/^Added \d+ starter concepts\.$/)).toBeTruthy();
    expect(await screen.findByText('Checkmate patterns', { selector: 'div' })).toBeTruthy();

    fireEvent.click(await screen.findByRole('link', { name: 'Fork' }));
    expect(await screen.findByRole('heading', { name: 'Fork' })).toBeTruthy();
    expect(await screen.findByText(/royal fork/)).toBeTruthy();
    expect(screen.getByText(/Tactical motifs · also: Knight fork, Family fork, Royal fork · #basic/)).toBeTruthy();
    // In the list at the side, and among the page's related concepts.
    expect(screen.getAllByRole('link', { name: 'Double attack' })).toHaveLength(2);

    // With every one there, the button goes.
    await waitFor(() => expect(screen.queryByRole('button', { name: /missing starter concept/ })).toBeNull());
  });
});

