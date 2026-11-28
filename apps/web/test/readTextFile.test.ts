// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readTextFile } from '../src/files.ts';

/** PGN files arrive in UTF-8 or, older ones, in Latin-1; both read right. */

describe('reading a text file', () => {
  it('reads UTF-8 as UTF-8', async () => {
    expect(await readTextFile(new Blob([new TextEncoder().encode('[White "Szabó, László"]')]))).toBe('[White "Szabó, László"]');
  });

  it('reads a Latin-1 file without turning its accents to question marks', async () => {
    // Every character here is below 256, so its code is its Windows-1252 byte (ó is 0xF3).
    const latin1 = Uint8Array.from('[White "Szabó, László"]', (c) => c.charCodeAt(0));
    expect(await readTextFile(new Blob([latin1]))).toBe('[White "Szabó, László"]');
  });
});
