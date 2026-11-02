import { describe, expect, it } from 'vitest';
import { canSendVendorNote, daysOut, draftVendorNote, isLongOut, looksLikeEmail, mailtoLink, sentLine } from './vendor-note';

const HOUR = 3_600_000;
const now = Date.parse('2026-11-02T14:00:00.000Z'); // Mon Nov 2, 9 AM in DC
const hoursAgo = (h: number) => new Date(now - h * HOUR).toISOString();

describe('the three-day rule', () => {
  it('starts at 72 hours, not before', () => {
    expect(isLongOut(hoursAgo(71.9), now)).toBe(false);
    expect(isLongOut(hoursAgo(72), now)).toBe(true);
    expect(isLongOut(hoursAgo(200), now)).toBe(true);
  });

  it('ignores items with no 86 time', () => {
    expect(isLongOut(undefined, now)).toBe(false);
    expect(isLongOut(null, now)).toBe(false);
    expect(isLongOut('not a date', now)).toBe(false);
  });

  it('counts whole days', () => {
    expect(daysOut(hoursAgo(72), now)).toBe(3);
    expect(daysOut(hoursAgo(98), now)).toBe(4);
    expect(daysOut(hoursAgo(2), now)).toBe(1);
  });
});

describe('the draft', () => {
  const note = draftVendorNote(
    { vendor: 'Chesapeake Seafood Co.', item: 'Pan-Roasted Halibut', restaurant: 'Main Street', outSince: '2026-10-29T22:00:00.000Z', sender: 'Priya M.' },
    now,
  );

  it('names the dish, the restaurant, the day it went out and how long', () => {
    expect(note.subject).toBe('Pan-Roasted Halibut: out since Thursday, Oct 29');
    expect(note.body).toContain('Hi Chesapeake Seafood Co.,');
    expect(note.body).toContain('Pan-Roasted Halibut has been off our menu at Main Street since Thursday, Oct 29 (3 days)');
    expect(note.body).toContain('When can you deliver more?');
  });

  it('is signed by the manager and the restaurant', () => {
    expect(note.body.endsWith('Thank you,\nPriya M.\nMain Street')).toBe(true);
  });

  it('uses restaurant time for the day, not UTC', () => {
    // 1 AM UTC on Oct 30 is still the evening of Oct 29 in DC
    const late = draftVendorNote({ vendor: 'V', item: 'Crab Cake', restaurant: 'Waterfront', outSince: '2026-10-30T01:00:00.000Z', sender: 'Dev P.' }, now);
    expect(late.subject).toBe('Crab Cake: out since Thursday, Oct 29');
  });
});

describe('opening it in the manager’s mail app', () => {
  it('fills in the address, subject and body, with spaces as %20 and real line breaks', () => {
    const link = mailtoLink(' orders@chesapeake.example ', { subject: 'Halibut: out since Thursday, Oct 29', body: 'Hi there,\n\nThanks' });
    expect(link).toBe('mailto:orders@chesapeake.example?subject=Halibut%3A%20out%20since%20Thursday%2C%20Oct%2029&body=Hi%20there%2C%0D%0A%0D%0AThanks');
    expect(link).not.toContain('+');
  });

  it('keeps an ampersand in the text from breaking the link', () => {
    expect(mailtoLink('a@b.co', { subject: 'Fish & Chips', body: 'x' })).toContain('subject=Fish%20%26%20Chips');
  });

  it('knows a plausible address from a typo', () => {
    expect(looksLikeEmail('orders@chesapeake.example')).toBe(true);
    expect(looksLikeEmail('orders@chesapeake')).toBe(false);
    expect(looksLikeEmail('orders chesapeake.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });

  it('says who sent it and when', () => {
    expect(sentLine('Priya M.', '2026-11-02T14:05:00.000Z')).toBe('Vendor emailed by Priya M., Mon, Nov 2');
  });
});

describe('who may send vendor notes', () => {
  it('owner anywhere; a manager at their own restaurant; nobody else', () => {
    expect(canSendVendorNote(['owner'], 'water')).toBe(true);
    expect(canSendVendorNote(['main-manager'], 'main')).toBe(true);
    expect(canSendVendorNote(['main-manager'], 'water')).toBe(false);
    expect(canSendVendorNote(['main-kitchen'], 'main')).toBe(false);
    expect(canSendVendorNote(['main-server'], 'main')).toBe(false);
    expect(canSendVendorNote([], 'main')).toBe(false);
  });
});
