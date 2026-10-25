import { describe, expect, it } from 'vitest';
import { fmtAgo, fmtDuration, initials } from './format';

describe('durations on the board', () => {
  it('reads like a person would say it', () => {
    expect(fmtDuration(42 * 60_000)).toBe('42m');
    expect(fmtDuration(186 * 60_000)).toBe('3h 6m');
    expect(fmtDuration(26 * 3_600_000)).toBe('1d 2h');
  });
});

describe('initials for the avatars', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Priya M.')).toBe('PM');
    expect(initials('Omar')).toBe('O');
    expect(initials('  ryan keiper  ')).toBe('RK');
    expect(initials('')).toBe('');
  });
});

describe('how long ago', () => {
  it('rounds to what matters', () => {
    expect(fmtAgo(2)).toBe('just now');
    expect(fmtAgo(30)).toBe('30s ago');
    expect(fmtAgo(125)).toBe('2m ago');
    expect(fmtAgo(7200)).toBe('2h ago');
  });
});
