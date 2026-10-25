import { describe, expect, it } from 'vitest';
import { Refused, canEditItem, parseAction, plan, type ItemState } from './transitions';

const now = '2026-10-25T23:30:00.000Z';
const item = (over: Partial<ItemState> = {}): ItemState => ({ id: 'main-halibut', restaurantId: 'main', name: 'Halibut', status: 'available', ...over });

describe('who may change the board', () => {
  it('owner anywhere; manager and kitchen at their own restaurant; nobody else', () => {
    expect(canEditItem(['owner'], 'water')).toBe(true);
    expect(canEditItem(['main-manager'], 'main')).toBe(true);
    expect(canEditItem(['main-kitchen'], 'main')).toBe(true);
    expect(canEditItem(['main-kitchen'], 'water')).toBe(false);
    expect(canEditItem(['main-server'], 'main')).toBe(false);
    expect(canEditItem(['main-host'], 'main')).toBe(false);
    expect(canEditItem([], 'main')).toBe(false);
  });
});

describe('reading the request', () => {
  it('trims and caps the note', () => {
    expect(parseAction({ action: 'out', note: '  Sold out  ' })).toEqual({ kind: 'out', note: 'Sold out' });
    expect((parseAction({ action: 'out', note: 'x'.repeat(200) }) as { note: string }).note).toHaveLength(80);
  });

  it('needs a real count for running low', () => {
    expect(parseAction({ action: 'low', count: 4 })).toEqual({ kind: 'low', count: 4 });
    expect(parseAction({ action: 'low', count: 2.6 })).toEqual({ kind: 'low', count: 3 });
    expect(parseAction({ action: 'low', count: 5000 })).toEqual({ kind: 'low', count: 999 });
    expect(() => parseAction({ action: 'low', count: 0 })).toThrow(Refused);
    expect(() => parseAction({ action: 'low' })).toThrow(Refused);
  });

  it('refuses anything else', () => {
    expect(parseAction({ action: 'back' })).toEqual({ kind: 'back' });
    expect(() => parseAction({ action: 'delete' })).toThrow('Unknown action');
  });
});

describe('86 it', () => {
  it('from available: marks it out, stamps the name, opens a history entry', () => {
    const p = plan(item(), { kind: 'out', note: 'Sold out' }, 'Marco R.', now);
    expect(p).toMatchObject({ kind: 'write', openEvent: true, closeNeeded: false, closeEventId: null });
    expect(p.kind === 'write' && p.update).toEqual({ status: 'out', outSince: now, note: 'Sold out', markedBy: 'Marco R.', lowCount: null, lowSince: null, openEventId: null });
  });

  it('from running low: clears the count and opens a history entry', () => {
    const p = plan(item({ status: 'low', lowCount: 2, lowSince: '2026-10-25T22:00:00.000Z', markedBy: 'Luis H.' }), { kind: 'out', note: '' }, 'Marco R.', now);
    expect(p.kind === 'write' && p.update).toMatchObject({ status: 'out', lowCount: null, lowSince: null, note: null, markedBy: 'Marco R.' });
    expect(p).toMatchObject({ openEvent: true });
  });

  it('twice does nothing', () => {
    expect(plan(item({ status: 'out', openEventId: 'ev1' }), { kind: 'out', note: '' }, 'Marco R.', now)).toEqual({ kind: 'noop', reason: "Halibut is already 86'd." });
  });
});

describe('running low', () => {
  it('from available: sets the count and the time', () => {
    const p = plan(item(), { kind: 'low', count: 4 }, 'Luis H.', now);
    expect(p.kind === 'write' && p.update).toEqual({ status: 'low', outSince: null, note: null, markedBy: 'Luis H.', lowCount: 4, lowSince: now, openEventId: null });
    expect(p).toMatchObject({ openEvent: false, closeNeeded: false });
  });

  it('a new count keeps the original since-time', () => {
    const p = plan(item({ status: 'low', lowCount: 4, lowSince: '2026-10-25T22:00:00.000Z' }), { kind: 'low', count: 2 }, 'Luis H.', now);
    expect(p.kind === 'write' && p.update).toMatchObject({ lowCount: 2, lowSince: '2026-10-25T22:00:00.000Z' });
  });

  it('from 86d: a few came back, so the open history entry gets closed', () => {
    const p = plan(item({ status: 'out', openEventId: 'ev1', outSince: '2026-10-25T20:00:00.000Z' }), { kind: 'low', count: 3 }, 'Luis H.', now);
    expect(p).toMatchObject({ closeNeeded: true, closeEventId: 'ev1', openEvent: false });
    expect(p.kind === 'write' && p.update).toMatchObject({ status: 'low', outSince: null, openEventId: null });
  });

  it('from 86d without a remembered entry still asks for it to be closed', () => {
    const p = plan(item({ status: 'out' }), { kind: 'low', count: 3 }, 'Luis H.', now);
    expect(p).toMatchObject({ closeNeeded: true, closeEventId: null });
  });
});

describe('back on', () => {
  it('from 86d: clears everything and closes the entry', () => {
    const p = plan(item({ status: 'out', openEventId: 'ev9', note: 'x', markedBy: 'M' }), { kind: 'back' }, 'Priya M.', now);
    expect(p).toMatchObject({ closeNeeded: true, closeEventId: 'ev9', openEvent: false });
    expect(p.kind === 'write' && p.update).toEqual({ status: 'available', outSince: null, note: null, markedBy: null, lowCount: null, lowSince: null, openEventId: null });
  });

  it('from running low: nothing to close', () => {
    const p = plan(item({ status: 'low', lowCount: 1 }), { kind: 'back' }, 'Priya M.', now);
    expect(p).toMatchObject({ closeNeeded: false, closeEventId: null });
  });

  it('when already on does nothing', () => {
    expect(plan(item(), { kind: 'back' }, 'Priya M.', now)).toEqual({ kind: 'noop', reason: 'Halibut is already on.' });
  });
});
