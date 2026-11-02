import { describe, expect, it } from 'vitest';
import type { MenuItem } from '../types';
import { FEED_GRACE_MS, HEARTBEAT_MS, POLL_MS, applyChange, checkEveryMs, linkStateOf, mergeLoaded, missedByFeed, noteDelivered, seenFrom } from './live';

const item = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  restaurantId: 'main',
  name: id,
  category: 'Mains',
  status: 'available',
  ...extra,
});

describe('applyChange', () => {
  const board = [item('a', { sortOrder: 1 }), item('b', { sortOrder: 2 }), item('c', { sortOrder: 3 })];

  it('replaces the changed item in place', () => {
    const next = applyChange(board, { kind: 'upsert', item: item('b', { sortOrder: 2, status: 'out', note: 'Ran out' }) }, 'main');
    expect(next.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(next[1].status).toBe('out');
    expect(next[1].note).toBe('Ran out');
    expect(board[1].status).toBe('available'); // the old list is left alone
  });

  it('adds a new item in menu order', () => {
    const next = applyChange(board, { kind: 'upsert', item: item('new', { sortOrder: 2.5 }) }, 'main');
    expect(next.map((i) => i.id)).toEqual(['a', 'b', 'new', 'c']);
  });

  it('ignores a change for another restaurant', () => {
    const next = applyChange(board, { kind: 'upsert', item: item('b', { restaurantId: 'water', status: 'out' }) }, 'main');
    expect(next).toBe(board);
  });

  it('removes a deleted item', () => {
    expect(applyChange(board, { kind: 'remove', id: 'b' }, 'main').map((i) => i.id)).toEqual(['a', 'c']);
    expect(applyChange(board, { kind: 'remove', id: 'zz' }, 'main')).toBe(board);
  });

  it('never lets an older copy replace a newer one', () => {
    const current = [item('a', { status: 'out', updatedAt: '2026-11-02T20:00:05.000Z' })];
    const late = item('a', { status: 'available', updatedAt: '2026-11-02T20:00:01.000Z' });
    expect(applyChange(current, { kind: 'upsert', item: late }, 'main')).toBe(current);
    const later = item('a', { status: 'available', updatedAt: '2026-11-02T20:00:09.000Z' });
    expect(applyChange(current, { kind: 'upsert', item: later }, 'main')[0].status).toBe('available');
  });
});

describe('mergeLoaded', () => {
  it('takes the full load, except a pushed change that is newer', () => {
    const current = [item('a', { status: 'out', updatedAt: '2026-11-02T20:00:05.000Z' }), item('b', { updatedAt: '2026-11-02T19:00:00.000Z' })];
    const loaded = [item('a', { status: 'available', updatedAt: '2026-11-02T20:00:01.000Z' }), item('b', { status: 'low', updatedAt: '2026-11-02T20:00:02.000Z' }), item('c')];
    const next = mergeLoaded(current, loaded);
    expect(next.map((i) => [i.id, i.status])).toEqual([
      ['a', 'out'], // pushed while the load was on its way
      ['b', 'low'], // the load is newer
      ['c', 'available'], // new on the load
    ]);
  });

  it('drops items the load no longer has', () => {
    expect(mergeLoaded([item('a'), item('gone')], [item('a')]).map((i) => i.id)).toEqual(['a']);
  });

  it('takes the load when there are no times to compare (the sample mode)', () => {
    expect(mergeLoaded([item('a', { status: 'out' })], [item('a')])[0].status).toBe('available');
  });
});

describe('the live connection', () => {
  it('reads Amplify connection states', () => {
    expect(linkStateOf('Connected')).toBe('live');
    expect(linkStateOf('Connecting')).toBe('connecting');
    expect(linkStateOf('ConnectedPendingKeepAlive')).toBe('connecting');
    expect(linkStateOf('ConnectedPendingNetwork')).toBe('connecting');
    expect(linkStateOf('ConnectionDisrupted')).toBe('down');
    expect(linkStateOf('ConnectionDisruptedPendingNetwork')).toBe('down');
    expect(linkStateOf('Disconnected')).toBe('down');
  });

  it('asks every 5 seconds unless the connection is live', () => {
    expect(checkEveryMs('live')).toBe(HEARTBEAT_MS);
    expect(checkEveryMs('connecting')).toBe(POLL_MS);
    expect(checkEveryMs('down')).toBe(POLL_MS);
    expect(checkEveryMs('none')).toBe(POLL_MS);
  });
});

describe('missedByFeed', () => {
  const start = Date.parse('2026-11-02T20:01:00.000Z');
  const at = (msBefore: number) => new Date(start - msBefore).toISOString();

  it('is fine when the feed delivered everything the load brings back', () => {
    const seen = seenFrom([item('a', { updatedAt: at(90_000) })]);
    noteDelivered(seen, { kind: 'upsert', item: item('a', { status: 'out', updatedAt: at(20_000) }) });
    expect(missedByFeed(seen, [item('a', { status: 'out', updatedAt: at(20_000) })], start)).toBe(false);
  });

  it('catches a change the feed never delivered', () => {
    const seen = seenFrom([item('a', { updatedAt: at(90_000) })]);
    expect(missedByFeed(seen, [item('a', { status: 'out', updatedAt: at(20_000) })], start)).toBe(true);
  });

  it('catches a new item the feed never delivered', () => {
    expect(missedByFeed(seenFrom([]), [item('new', { updatedAt: at(20_000) })], start)).toBe(true);
  });

  it('gives a change saved moments ago time to arrive, then catches it on the next load', () => {
    const seen = seenFrom([item('a', { updatedAt: at(90_000) })]);
    const change = item('a', { status: 'out', updatedAt: at(FEED_GRACE_MS - 500) });
    expect(missedByFeed(seen, [change], start)).toBe(false);
    expect(missedByFeed(seen, [change], start + 30_000)).toBe(true); // the feed never brought it
  });

  it('forgets removed items', () => {
    const seen = seenFrom([item('a', { updatedAt: at(90_000) })]);
    noteDelivered(seen, { kind: 'remove', id: 'a' });
    expect(seen.has('a')).toBe(false);
  });

  it('never moves backwards', () => {
    const seen = seenFrom([item('a', { updatedAt: at(10_000) })]);
    noteDelivered(seen, { kind: 'upsert', item: item('a', { updatedAt: at(50_000) }) });
    expect(seen.get('a')).toBe(at(10_000));
  });

  it('has nothing to compare in the sample mode', () => {
    expect(missedByFeed(seenFrom([item('a')]), [item('a', { status: 'out' })], start)).toBe(false);
  });
});
