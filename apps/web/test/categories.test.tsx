import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/App.tsx';
import { startServer } from './server.ts';

/** Position categories are the person's own: added while saving, then renamed or removed on the Positions screen. */

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

describe('position categories', () => {
  it('adds a category from the save dialog, lists it with its count, renames and removes it', async () => {
    startServer();
    render(<App />);

    // Save the starting position under a category that does not exist yet.
    fireEvent.keyDown(window, { key: 's' });
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Opening principles' } });
    fireEvent.click(screen.getByRole('button', { name: 'More details (optional)…' }));
    const picker = screen.getByLabelText('Category') as HTMLSelectElement;
    await waitFor(() =>
      expect([...picker.options].map((o) => o.text)).toEqual(['None', 'Tactic', 'Strategy', 'Endgame', 'Opening', 'Calculation', 'Defense', 'New category…']),
    );
    fireEvent.change(picker, { target: { value: [...picker.options].at(-1)!.value } });
    await answer('New category', 'Principles');
    await waitFor(() => expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('Principles'));
    fireEvent.submit(screen.getByLabelText('Title').closest('form')!);
    await screen.findByText('Saved “Opening principles”.');

    // The Positions screen lists it with one position; clicking it filters.
    go('#/positions');
    const categories = () => screen.getByText('Categories').parentElement!;
    const principles = await waitFor(() => within(categories()).getByRole('button', { name: /Principles\s*1/ }));
    fireEvent.click(principles);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Opening principles' })).toBeTruthy());

    // Renaming carries over to the save; a name already taken is refused.
    fireEvent.click(within(categories()).getByRole('button', { name: 'Rename' }));
    await answer('Rename category', 'tactic');
    expect(await screen.findByText('There is already a category called “Tactic”.')).toBeTruthy();
    fireEvent.click(within(categories()).getByRole('button', { name: 'Rename' }));
    await answer('Rename category', 'First principles');
    await waitFor(() => within(categories()).getByRole('button', { name: /First principles\s*1/ }));

    // Removing it leaves the position saved, without a category.
    fireEvent.click(within(categories()).getByRole('button', { name: 'Remove category' }));
    expect(await screen.findByText('Removed the category “First principles”. Its position stays saved, without a category.')).toBeTruthy();
    await waitFor(() => expect(within(categories()).queryByRole('button', { name: /First principles/ })).toBeNull());
    expect(screen.getByRole('button', { name: 'Open Opening principles' })).toBeTruthy();
  });
});
