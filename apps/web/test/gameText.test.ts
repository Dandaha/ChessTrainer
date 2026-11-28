import { describe, expect, it } from 'vitest';
import { formatPgnDate, myOutcome } from '../src/gameText.ts';

describe('game facts in words', () => {
  it('writes PGN dates as people do, as far as they are known', () => {
    expect(formatPgnDate('2026.11.25')).toBe('25 Nov 2026');
    expect(formatPgnDate('2026.01.??')).toBe('Jan 2026');
    expect(formatPgnDate('2026.??.??')).toBe('2026');
    expect(formatPgnDate('????.??.??')).toBe('');
    expect(formatPgnDate(null)).toBe('');
  });

  it('says how the game went for me, only when my side and the result are known', () => {
    expect(myOutcome({ result: '1-0', myColor: 'white' })).toBe('Won');
    expect(myOutcome({ result: '1-0', myColor: 'black' })).toBe('Lost');
    expect(myOutcome({ result: '0-1', myColor: 'black' })).toBe('Won');
    expect(myOutcome({ result: '1/2-1/2', myColor: 'white' })).toBe('Drawn');
    expect(myOutcome({ result: '*', myColor: 'white' })).toBeNull();
    expect(myOutcome({ result: '1-0', myColor: null })).toBeNull();
  });
});
