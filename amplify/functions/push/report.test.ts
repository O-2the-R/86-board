import { describe, expect, it } from 'vitest';
import { TZ, buildReport, changeOf, dayBounds, fmtDuration, pushMessage, yesterdayIn, type Image } from './report';

describe('restaurant-time day boundaries', () => {
  it('covers a normal day in Eastern Daylight Time', () => {
    expect(dayBounds('2026-10-24', TZ)).toEqual({ start: '2026-10-24T04:00:00.000Z', end: '2026-10-25T04:00:00.000Z' });
  });

  it('covers the 25-hour fall-back day exactly', () => {
    // Nov 1 2026: clocks go back at 2 AM, so the day runs from 4:00Z to 5:00Z next day.
    expect(dayBounds('2026-11-01', TZ)).toEqual({ start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' });
  });

  it('covers the 23-hour spring-forward day exactly', () => {
    expect(dayBounds('2026-03-08', TZ)).toEqual({ start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' });
  });

  it('crosses the year end', () => {
    expect(dayBounds('2026-12-31', TZ)).toEqual({ start: '2026-12-31T05:00:00.000Z', end: '2027-01-01T05:00:00.000Z' });
  });

  it('knows yesterday by restaurant time, not UTC', () => {
    // 1:30 AM UTC on Oct 26 is still the evening of Oct 25 in Washington.
    expect(yesterdayIn(TZ, new Date('2026-10-26T01:30:00Z'))).toBe('2026-10-24');
    // 9:00 AM Washington on Oct 26 (13:00Z) -> yesterday is Oct 25.
    expect(yesterdayIn(TZ, new Date('2026-10-26T13:00:00Z'))).toBe('2026-10-25');
  });
});

describe('durations', () => {
  it('reads like a person would say it', () => {
    expect(fmtDuration(0)).toBe('0m');
    expect(fmtDuration(45 * 60_000)).toBe('45m');
    expect(fmtDuration(60 * 60_000)).toBe('1h');
    expect(fmtDuration(130 * 60_000)).toBe('2h 10m');
    expect(fmtDuration(26 * 3_600_000)).toBe('1d 2h');
    expect(fmtDuration(48 * 3_600_000)).toBe('2d');
  });

  it('never goes negative', () => {
    expect(fmtDuration(-5_000)).toBe('0m');
  });
});

describe('the morning report', () => {
  const now = Date.parse('2026-10-25T13:00:00Z'); // 9 AM Washington
  const perRestaurant = [
    {
      name: 'Main Street',
      events: [
        { itemName: 'Pan-Roasted Halibut', startedAt: '2026-10-24T23:52:00Z', endedAt: '2026-10-25T01:10:00Z', note: 'Vendor short', markedBy: 'Marco R.', clearedBy: 'Priya M.' },
        { itemName: 'Burrata & Peach', startedAt: '2026-10-24T22:00:00Z', markedBy: 'Marco R.' },
      ],
    },
    { name: 'Waterfront', events: [] },
  ];

  it('flattens rows in time order with durations and who did what', () => {
    const r = buildReport('2026-10-24', perRestaurant, now);
    expect(r.total).toBe(2);
    expect(r.rows.map((x) => x.item)).toEqual(['Burrata & Peach', 'Pan-Roasted Halibut']);
    const halibut = r.rows[1];
    expect(halibut).toMatchObject({ restaurant: 'Main Street', outAt: '7:52 PM', backAt: '9:10 PM', backBy: 'Priya M.', outFor: '1h 18m', stillOut: false, note: 'Vendor short' });
    const burrata = r.rows[0];
    expect(burrata.stillOut).toBe(true);
    expect(burrata.backAt).toBe('');
    expect(burrata.outFor).toBe('15h'); // from 6 PM yesterday to 9 AM today
  });

  it('writes a subject and an email a manager can read', () => {
    const r = buildReport('2026-10-24', perRestaurant, now);
    expect(r.subject).toBe("86 Board: 2 items 86'd Saturday, Oct 24");
    expect(r.html).toContain('Main Street · 2');
    expect(r.html).toContain('Waterfront · 0');
    expect(r.html).toContain("Nothing 86'd.");
    expect(r.html).toContain('still out');
    expect(r.html).toContain('back on by Priya M.');
  });

  it('says so when nothing was 86d', () => {
    const r = buildReport('2026-10-24', [{ name: 'Main Street', events: [] }], now);
    expect(r.total).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.subject).toBe("86 Board: nothing was 86'd Saturday, Oct 24");
  });

  it('escapes anything a person typed into a note', () => {
    const r = buildReport('2026-10-24', [{ name: 'Main', events: [{ itemName: 'Tuna <Crudo>', startedAt: '2026-10-24T22:00:00Z', markedBy: 'A & B' }] }], now);
    expect(r.html).toContain('Tuna &lt;Crudo&gt;');
    expect(r.html).toContain('A &amp; B');
    expect(r.html).not.toContain('<Crudo>');
  });
});

const img = (fields: Record<string, string | number | undefined>): Image => {
  const out: Image = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? { N: String(v) } : { S: v };
  }
  return out;
};

describe('what counts as a change worth a buzz', () => {
  const base = { id: 'main:halibut', restaurantId: 'main', name: 'Halibut' };

  it('available to 86d', () => {
    const c = changeOf(img({ ...base, status: 'available' }), img({ ...base, status: 'out', note: 'Sold out', markedBy: 'Marco R.' }));
    expect(c).toMatchObject({ kind: 'out', name: 'Halibut', note: 'Sold out', by: 'Marco R.', restaurantId: 'main' });
    expect(pushMessage(c!, 'Main Street')).toEqual({ title: "86'd: Halibut", body: 'Main Street. Sold out. Marco R.', tag: 'item-main:halibut' });
  });

  it('available to running low, and a changed count', () => {
    const low = changeOf(img({ ...base, status: 'available' }), img({ ...base, status: 'low', lowCount: 4, markedBy: 'Luis H.' }));
    expect(low).toMatchObject({ kind: 'low', count: 4 });
    expect(pushMessage(low!, 'Main Street').title).toBe('Running low: Halibut, last 4');
    const fewer = changeOf(img({ ...base, status: 'low', lowCount: 4 }), img({ ...base, status: 'low', lowCount: 2 }));
    expect(fewer).toMatchObject({ kind: 'low', count: 2 });
  });

  it('back on from either state', () => {
    expect(changeOf(img({ ...base, status: 'out' }), img({ ...base, status: 'available' }))).toMatchObject({ kind: 'back' });
    expect(changeOf(img({ ...base, status: 'low', lowCount: 2 }), img({ ...base, status: 'available' }))).toMatchObject({ kind: 'back' });
  });

  it('ignores edits that are not a status change', () => {
    expect(changeOf(img({ ...base, status: 'out', note: 'a' }), img({ ...base, status: 'out', note: 'b' }))).toBeNull();
    expect(changeOf(img({ ...base, status: 'low', lowCount: 3 }), img({ ...base, status: 'low', lowCount: 3 }))).toBeNull();
    expect(changeOf(img({ ...base, status: 'available' }), undefined)).toBeNull();
  });
});
