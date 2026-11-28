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

  it('files concepts under the person’s own categories: a new one from the editor, folding groups, a rename', async () => {
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

    // Its group opens for the open concept; the others stay closed until clicked.
    expect(await screen.findByRole('button', { name: 'Checkmate patterns', expanded: true })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Arabian mate' })).toBeTruthy();
    const tactics = screen.getByRole('button', { name: 'Tactical motifs', expanded: false });
    expect(screen.queryByRole('link', { name: 'Fork' })).toBeNull();
    fireEvent.click(tactics);
    expect(screen.getByRole('link', { name: 'Fork' })).toBeTruthy();
    fireEvent.click(tactics);
    expect(screen.queryByRole('link', { name: 'Fork' })).toBeNull();

    // Renamed from its row's menu, it is renamed on the concept too, and stays open.
    fireEvent.click(screen.getByRole('button', { name: 'Category options: Checkmate patterns' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Rename category' }), { target: { value: 'Mating patterns' } });
    fireEvent.submit(screen.getByRole('textbox', { name: 'Rename category' }).closest('form')!);
    await waitFor(async () => expect((await app.inject({ method: 'GET', url: `/api/concepts/${id}` })).json().category).toBe('Mating patterns'));
    expect(await screen.findByRole('button', { name: 'Mating patterns', expanded: true })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Arabian mate' })).toBeTruthy();
    expect(within(screen.getByRole('main')).getAllByText(/Mating patterns/).length).toBeGreaterThan(0);
  });

  it('gives concepts a level, sorts them easiest first, groups them by level, and remembers how', async () => {
    const { app } = startServer();
    for (const [title, level] of [['Zwischenzug', 'basic'], ['Clearance', 'advanced'], ['Pin', 'intermediate']]) {
      await app.inject({ method: 'POST', url: '/api/concepts', payload: { title, level, category: 'Tactical motifs' } });
    }
    const { id } = (await app.inject({ method: 'POST', url: '/api/concepts', payload: { title: 'Opposition', category: 'Endgame technique' } })).json();
    render(<App />);
    go(`#/concepts/${id}`);
    const side = () => within(screen.getByRole('complementary', { name: 'Concepts' }));
    await screen.findByRole('complementary', { name: 'Concepts' });
    const titles = () => side().queryAllByRole('link').map((a) => a.textContent);

    // A–Z at first; easiest first on request, each row marked with its level.
    fireEvent.click(await side().findByRole('button', { name: 'Tactical motifs' }));
    // Tactical motifs comes before Endgame technique in the categories' own order.
    await waitFor(() => expect(titles()).toEqual(['Clearance', 'Pin', 'Zwischenzug', 'Opposition']));
    fireEvent.click(side().getByRole('button', { name: 'Sort: A–Z' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Easiest first' }));
    expect(titles()).toEqual(['Zwischenzug', 'Pin', 'Clearance', 'Opposition']);
    expect(side().getByRole('link', { name: 'Clearance' }).querySelector('[data-level]')!.getAttribute('title')).toBe('Advanced');

    // The editor sets a level; the page shows it.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Advanced' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await app.inject({ method: 'GET', url: `/api/concepts/${id}` })).json().level).toBe('advanced'));
    expect(await within(screen.getByRole('main')).findByText('Advanced', { selector: 'span' })).toBeTruthy();

    // By level: the open concept's level is open, the rest closed; easiest first means nothing there.
    fireEvent.click(side().getByRole('radio', { name: 'Levels' }));
    expect(await side().findByRole('button', { name: 'Advanced', expanded: true })).toBeTruthy();
    await waitFor(() => expect(titles()).toEqual(['Clearance', 'Opposition']));
    expect(side().getByRole('button', { name: 'Basic', expanded: false })).toBeTruthy();
    expect(side().getByRole('button', { name: 'Sort: A–Z' })).toBeTruthy();

    // Expand all, then collapse all.
    fireEvent.click(side().getByRole('button', { name: 'Expand all' }));
    expect(titles()).toEqual(['Zwischenzug', 'Pin', 'Clearance', 'Opposition']);
    fireEvent.click(side().getByRole('button', { name: 'Collapse all' }));
    expect(titles()).toEqual([]);

    // A search opens every group with a match.
    fireEvent.change(side().getByLabelText('Search concepts'), { target: { value: 'pin' } });
    await waitFor(() => expect(titles()).toEqual(['Pin']));
    expect(side().getByRole('button', { name: 'Intermediate', expanded: true })).toBeTruthy();

    // Kept for next time.
    expect(JSON.parse(localStorage.getItem('chess-workspace:concepts-view')!)).toMatchObject({ group: 'level', sort: 'level' });
  });

  it('fills the library with the starter concepts on request, and only once', async () => {
    startServer();
    render(<App />);
    go('#/concepts');
    expect(await screen.findByText(/Your chess wiki is empty/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^Add \d+ missing starter concepts$/ }));
    expect(await screen.findByText(/^Added \d+ starter concepts\.$/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Checkmate patterns', expanded: false })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tactical motifs' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Fork' }));
    expect(await screen.findByRole('heading', { name: 'Fork' })).toBeTruthy();
    expect(await screen.findByText(/royal fork/)).toBeTruthy();
    expect(screen.getByText('Tactical motifs · also: Knight fork, Family fork, Royal fork')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('Basic', { selector: 'span' })).toBeTruthy();
    // In the list at the side, and among the page's related concepts.
    expect(screen.getAllByRole('link', { name: 'Double attack' })).toHaveLength(2);

    // With every one there, the button goes.
    await waitFor(() => expect(screen.queryByRole('button', { name: /missing starter concept/ })).toBeNull());
  });
});

