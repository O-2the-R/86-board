// The live feed on the real app, with AWS swapped for stand-ins: checks the
// subscriptions ask for one restaurant only, turn the server's rows into board
// items, follow the connection's ups and downs, and stop cleanly.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemChange } from '../lib/live';

type Observer = { next: (row: Record<string, unknown>) => void; error: (e: unknown) => void };
interface FakeSub {
  op: string;
  filter: unknown;
  observer: Observer;
  stopped: boolean;
}

const fake = vi.hoisted(() => ({
  subs: [] as FakeSub[],
  hub: [] as ((e: { payload: { event: string; data?: unknown } }) => void)[],
}));

vi.mock('aws-amplify/data', () => {
  const op = (name: string) => (opts: { filter: unknown }) => ({
    subscribe: (observer: Observer) => {
      const sub: FakeSub = { op: name, filter: opts.filter, observer, stopped: false };
      fake.subs.push(sub);
      return { unsubscribe: () => (sub.stopped = true) };
    },
  });
  return {
    CONNECTION_STATE_CHANGE: 'ConnectionStateChange',
    generateClient: () => ({ models: { MenuItem: { onCreate: op('create'), onUpdate: op('update'), onDelete: op('delete') } } }),
  };
});

vi.mock('aws-amplify/utils', () => ({
  Hub: { listen: (_channel: string, cb: (e: { payload: { event: string; data?: unknown } }) => void) => fake.hub.push(cb) },
}));

const { awsApi } = await import('./aws');

const say = (connectionState: string) => fake.hub.forEach((cb) => cb({ payload: { event: 'ConnectionStateChange', data: { connectionState } } }));

function watch(restaurantId: string) {
  const changes: ItemChange[] = [];
  const links: string[] = [];
  let failures = 0;
  const stop = awsApi.watchItems(restaurantId, {
    change: (c) => changes.push(c),
    link: (s) => links.push(s),
    failed: () => failures++,
  });
  return { changes, links, failures: () => failures, stop: stop! };
}

const row = {
  id: 'main-branzino',
  restaurantId: 'main',
  name: 'Whole Branzino',
  category: 'Mains',
  vendor: 'Chesapeake Seafood Co.',
  sortOrder: 4,
  status: 'out',
  outSince: '2026-11-02T20:00:00.000Z',
  note: "Didn't come in",
  markedBy: 'Marco R.',
  lowCount: null,
  lowSince: null,
  vendorNoteAt: null,
  vendorNoteBy: null,
  editors: ['main-manager', 'main-kitchen'],
  readers: ['main-manager', 'main-kitchen', 'main-server', 'main-host'],
  updatedAt: '2026-11-02T20:00:00.500Z',
};

describe('the live feed', () => {
  beforeEach(() => {
    fake.subs.length = 0;
  });

  it('listens for new, changed and removed items at one restaurant only', () => {
    const w = watch('main');
    expect(fake.subs.map((s) => s.op)).toEqual(['create', 'update', 'delete']);
    for (const s of fake.subs) expect(s.filter).toEqual({ restaurantId: { eq: 'main' } });
    w.stop();
  });

  it('turns a pushed row into a board item', () => {
    const w = watch('main');
    fake.subs[1].observer.next(row);
    expect(w.changes).toEqual([
      {
        kind: 'upsert',
        item: {
          id: 'main-branzino',
          restaurantId: 'main',
          name: 'Whole Branzino',
          category: 'Mains',
          vendor: 'Chesapeake Seafood Co.',
          sortOrder: 4,
          status: 'out',
          outSince: '2026-11-02T20:00:00.000Z',
          note: "Didn't come in",
          markedBy: 'Marco R.',
          lowCount: undefined,
          lowSince: undefined,
          vendorNoteAt: undefined,
          vendorNoteBy: undefined,
          updatedAt: '2026-11-02T20:00:00.500Z',
        },
      },
    ]);
    fake.subs[2].observer.next(row);
    expect(w.changes[1]).toEqual({ kind: 'remove', id: 'main-branzino' });
    w.stop();
  });

  it('follows the connection, and says where it stands when it is already up', () => {
    const first = watch('main');
    say('Connecting');
    say('Connected');
    say('ConnectionDisrupted');
    say('Connected');
    expect(first.links).toEqual(['connecting', 'live', 'down', 'live']);
    first.stop();

    // Switching restaurants: the connection stays up and announces nothing.
    const second = watch('water');
    expect(second.links).toEqual(['live']);
    second.stop();
  });

  it('reports a feed that stopped, so the board can start it again', () => {
    const w = watch('main');
    fake.subs[0].observer.error(new Error('Unauthorized'));
    expect(w.failures()).toBe(1);
    w.stop();
  });

  it('stops every subscription and stops hearing about the connection', () => {
    const w = watch('main');
    w.stop();
    expect(fake.subs.every((s) => s.stopped)).toBe(true);
    say('ConnectionDisrupted');
    expect(w.links).not.toContain('down');
  });
});
