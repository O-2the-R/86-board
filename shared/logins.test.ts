import { describe, expect, it } from 'vitest';
import {
  PASSWORD_COMBINATIONS,
  SYMBOLS,
  WORDS,
  cleanUsername,
  loginMessage,
  nextFreeUsername,
  passesPolicy,
  passwordFrom,
  plainLetters,
  usernameCandidates,
  usernameFor,
} from './logins';

// A fixed sequence instead of real randomness, so the tests are repeatable.
const sequence = (...values: number[]) => {
  let i = 0;
  return (n: number) => values[i++ % values.length] % n;
};

describe('usernames from names', () => {
  it('keeps the old suggestions unchanged', () => {
    expect(usernameFor('Marco R.')).toBe('marco.r');
    expect(usernameFor('  Ryan Keiper ')).toBe('ryan.keiper');
  });

  it('turns accents into plain letters, so what you see is what gets saved', () => {
    expect(usernameFor('José Peña')).toBe('jose.pena');
    expect(usernameFor('Ana-María López')).toBe('ana-maria.lopez');
    expect(usernameFor('Zoë Müller')).toBe('zoe.muller');
    expect(usernameFor('Søren Łukasz')).toBe('soren.lukasz');
    expect(usernameFor("Siobhán O'Brien")).toBe('siobhan.obrien');
  });

  it('cleans what managers type the same way', () => {
    expect(cleanUsername('  Ryan.Keiper ')).toBe('ryan.keiper');
    expect(cleanUsername('Marco R!')).toBe('marcor');
    expect(cleanUsername('josé.peña')).toBe('jose.pena');
    expect(plainLetters('crème brûlée')).toBe('creme brulee');
  });
});

describe('the next free username', () => {
  it('keeps the username when nobody has it', () => {
    expect(nextFreeUsername('marco.r', () => false)).toBe('marco.r');
  });

  it('adds 2, then 3, when it is taken', () => {
    const taken = new Set(['marco.r', 'marco.r2']);
    expect(nextFreeUsername('marco.r', (u) => taken.has(u))).toBe('marco.r3');
  });

  it('tries marco.r up to marco.r99, then gives up', () => {
    const list = usernameCandidates('marco.r');
    expect(list[0]).toBe('marco.r');
    expect(list[1]).toBe('marco.r2');
    expect(list.at(-1)).toBe('marco.r99');
    expect(nextFreeUsername('marco.r', () => true)).toBeNull();
    expect(nextFreeUsername('', () => false)).toBeNull();
  });
});

describe('generated passwords', () => {
  it('reads like Basil-Tray-4821!', () => {
    expect(passwordFrom(sequence(0, 0, 3821, 0))).toBe('Basil-Tray-4821!');
  });

  it('never uses the same word twice', () => {
    // second pick 0 would be basil again; it skips to the next word
    expect(passwordFrom(sequence(0, 0, 0, 0))).toBe('Basil-Tray-1000!');
    expect(passwordFrom(sequence(5, 5, 0, 0)).split('-').slice(0, 2)).toEqual(['Whisk', 'Sage']);
    for (let i = 0; i < 500; i++) {
      const [a, b] = passwordFrom((n) => Math.floor(Math.random() * n)).split('-');
      expect(a).not.toBe(b);
    }
  });

  it('always passes the login rules: 8+ characters, capital, lowercase, number, symbol', () => {
    for (let i = 0; i < 2000; i++) {
      const p = passwordFrom((n) => Math.floor(Math.random() * n));
      expect(passesPolicy(p)).toBe(true);
      expect(p).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}[!?]$/);
    }
  });

  it('covers the whole word list and every digit range', () => {
    const last = WORDS.length - 1;
    expect(passwordFrom(sequence(last, 0, 8999, SYMBOLS.length - 1))).toMatch(/^Ramekin-Basil-9999\?$/);
  });

  it('has hundreds of millions of possibilities, not 9,000', () => {
    expect(PASSWORD_COMBINATIONS).toBeGreaterThan(300_000_000);
  });

  it('uses short, plain kitchen words with no repeats', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
    expect(WORDS.length).toBeGreaterThanOrEqual(200);
  });

  it('the policy check refuses the weak ones', () => {
    expect(passesPolicy('basil-tray-4821!')).toBe(false); // no capital
    expect(passesPolicy('Basil-Tray-!')).toBe(false); // no number
    expect(passesPolicy('BasilTray4821')).toBe(false); // no symbol
    expect(passesPolicy('Ba-1!')).toBe(false); // too short
  });
});

describe('the login message', () => {
  it('has everything a new person needs to sign in', () => {
    const msg = loginMessage({ name: 'Luis G.', link: 'https://example.com', username: 'luis.g', password: 'Basil-Tray-4821!', temporary: true });
    expect(msg).toBe(
      [
        'Hi Luis, here is your 86 Board login.',
        'Open: https://example.com',
        'Username: luis.g',
        'Temporary password: Basil-Tray-4821!',
        'You pick your own password the first time you sign in.',
      ].join('\n'),
    );
  });

  it('says Password, not Temporary password, when the manager set it for good', () => {
    const msg = loginMessage({ name: 'Priya M.', link: 'https://example.com', username: 'priya.m', password: 'Fennel-Pass-7302!', temporary: false });
    expect(msg).toContain('Password: Fennel-Pass-7302!');
    expect(msg).not.toContain('Temporary');
    expect(msg).not.toContain('first time');
  });
});
