import { describe, expect, it } from 'vitest';
import { actorFromIdentity, Refused } from './rules';
import { KINDS, OWN_SLOT, goes, removeSamples, setUp, whatGoes, type Kind, type RestaurantRow, type Row, type SiteDb } from './site';

const owner = actorFromIdentity({ username: 'omar', groups: ['owner'] });
const BEFORE = '2026-11-01T12:00:00.000Z'; // when the samples were loaded
const SETUP = '2026-11-20T21:00:00.000Z'; // when the owner set up their restaurant
const AFTER = '2026-11-21T15:00:00.000Z'; // real data made since

// A site as "Load demo data" leaves it, in memory.
function site() {
  let restaurants: RestaurantRow[] = [
    { id: 'main', name: 'Main Street', kind: 'Full service', sortOrder: 0 },
    { id: 'water', name: 'Waterfront', kind: 'Full service', sortOrder: 1 },
    { id: 'counter', name: 'The Counter', kind: 'Fast casual', sortOrder: 2 },
  ];
  const at = (id: string, restaurantId: string, createdAt = BEFORE, role?: string): Row => ({ id, restaurantId, createdAt, role });
  const tables: Record<Exclude<Kind, 'Restaurant'>, Row[]> = {
    Staff: [at('omar', 'all', BEFORE, 'owner'), at('priya.m', 'main', BEFORE, 'manager'), at('sam.t', 'main', BEFORE, 'server'), at('dev.p', 'water', BEFORE, 'manager'), at('lena.k', 'counter', BEFORE, 'host')],
    MenuItem: [at('main-tiramisu', 'main'), at('main-caesar', 'main'), at('water-oysters', 'water'), at('counter-fries', 'counter')],
    EightySixEvent: [at('e1', 'main'), at('e2', 'water'), at('e3', 'counter')],
    Vendor: [at('main-capital-meats', 'main'), at('water-fish', 'water')],
    PushSubscription: [at('p-omar', 'all'), at('p-sam', 'main'), at('p-dev', 'water')],
    AskLists: [at('main', 'main'), at('water', 'water')],
    AskUsage: [at('main:2026-11-20', 'main'), at('counter:2026-11-19', 'counter')],
  };
  const loginsRemoved: string[] = [];
  const db: SiteDb = {
    restaurants: async () => restaurants.map((r) => ({ ...r })),
    saveRestaurant: async (row, isNew) => {
      if (isNew === restaurants.some((r) => r.id === row.id)) throw new Error('create/update mixed up');
      restaurants = [...restaurants.filter((r) => r.id !== row.id), { ...row }];
    },
    list: async (kind) => (kind === 'Restaurant' ? restaurants.map((r) => ({ id: r.id, createdAt: BEFORE })) : tables[kind].map((r) => ({ ...r }))),
    remove: async (kind, id) => {
      if (kind === 'Restaurant') restaurants = restaurants.filter((r) => r.id !== id);
      else tables[kind] = tables[kind].filter((r) => r.id !== id);
    },
  };
  const ids = (kind: Exclude<Kind, 'Restaurant'>) => tables[kind].map((r) => r.id);
  return { db, tables, ids, loginsRemoved, logins: { remove: async (u: string) => void loginsRemoved.push(u) }, names: () => restaurants.map((r) => r.name) };
}

const said = async (p: Promise<unknown>) => p.then(() => 'done', (e) => (e instanceof Refused ? e.message : Promise.reject(e)));

describe('setting up the owner\'s own restaurant', () => {
  it('names the first slot and marks it as their own, from that moment', async () => {
    const s = site();
    const own = await setUp(s.db, '  Nonna   (Midtown DC) ', SETUP);
    expect(own).toEqual({ id: OWN_SLOT, name: 'Nonna (Midtown DC)', kind: 'Restaurant', sortOrder: 0, own: true, ownSince: SETUP, samplesGone: false });
    expect((await s.db.restaurants()).find((r) => r.id === 'main')).toMatchObject({ name: 'Nonna (Midtown DC)', own: true });
  });

  it('renames it later without moving that moment', async () => {
    const s = site();
    await setUp(s.db, 'Nonna', SETUP);
    expect(await setUp(s.db, 'Nonna (Midtown DC)', AFTER)).toMatchObject({ name: 'Nonna (Midtown DC)', ownSince: SETUP, kind: 'Restaurant' });
  });

  it('works on a site with no restaurants at all, and asks for a real name', async () => {
    const s = site();
    for (const id of ['main', 'water', 'counter']) await s.db.remove('Restaurant', id);
    expect(await said(setUp(s.db, ' ', SETUP))).toBe('Type the name of your restaurant.');
    expect(await said(setUp(s.db, 'x'.repeat(41), SETUP))).toBe('Keep the name under 40 characters.');
    expect((await setUp(s.db, 'Nonna', SETUP)).ownSince).toBe(SETUP);
    expect(s.names()).toEqual(['Nonna']);
  });
});

describe('what goes when the samples are removed', () => {
  it('is everything at the other slots, and at the own slot only what was there before', () => {
    expect(goes('MenuItem', { id: 'a', restaurantId: 'water', createdAt: AFTER }, SETUP, owner)).toBe(true);
    expect(goes('MenuItem', { id: 'a', restaurantId: 'main', createdAt: BEFORE }, SETUP, owner)).toBe(true);
    expect(goes('MenuItem', { id: 'a', restaurantId: 'main', createdAt: AFTER }, SETUP, owner)).toBe(false);
    expect(goes('EightySixEvent', { id: 'e', restaurantId: 'main', createdAt: AFTER }, SETUP, owner)).toBe(false);
    expect(goes('Vendor', { id: 'v', restaurantId: 'main' }, SETUP, owner)).toBe(true); // no date: taken as old
  });

  it('never the owner, whoever asks and however the row looks', () => {
    for (const row of [
      { id: 'omar', restaurantId: 'all', role: 'owner', createdAt: BEFORE },
      { id: 'omar', restaurantId: 'main', role: 'manager', createdAt: BEFORE }, // the one asking
      { id: 'ryan', restaurantId: 'water', role: 'owner', createdAt: BEFORE }, // any owner
      { id: 'x', restaurantId: 'all', role: 'manager', createdAt: BEFORE },
    ])
      expect(goes('Staff', row, SETUP, owner), row.id + row.restaurantId).toBe(false);
    expect(goes('PushSubscription', { id: 'p', restaurantId: 'all', createdAt: BEFORE }, SETUP, owner)).toBe(false);
  });

  it("keeps the lists loaded for the owner's own restaurant, which are older than the set-up", () => {
    expect(goes('AskLists', { id: 'main', restaurantId: 'main', createdAt: BEFORE }, SETUP, owner)).toBe(false);
    expect(goes('AskLists', { id: 'water', restaurantId: 'water', createdAt: AFTER }, SETUP, owner)).toBe(true);
    expect(goes('Restaurant', { id: 'main' }, SETUP, owner)).toBe(false);
    expect(goes('Restaurant', { id: 'counter' }, SETUP, owner)).toBe(true);
  });

  it('is counted for the owner before they say yes', async () => {
    const s = site();
    const before = await whatGoes(s.db, owner, SETUP);
    expect(before.own).toBeUndefined();
    expect(before.counts).toEqual({ Staff: 4, MenuItem: 4, EightySixEvent: 3, Vendor: 2, PushSubscription: 2, AskLists: 1, AskUsage: 1, Restaurant: 2 });
  });
});

describe('removing the samples', () => {
  it('is refused until the owner has set up their restaurant', async () => {
    const s = site();
    expect(await said(removeSamples(s.db, s.logins, owner))).toBe('Set up your restaurant first.');
    expect(s.ids('Staff')).toHaveLength(5);
  });

  it('leaves one restaurant, the owner, and the lists loaded for it', async () => {
    const s = site();
    await setUp(s.db, 'Nonna (Midtown DC)', SETUP);
    const res = await removeSamples(s.db, s.logins, owner);
    expect(res).toMatchObject({ done: true, left: 0, removed: { Staff: 4, MenuItem: 4, EightySixEvent: 3, Vendor: 2, PushSubscription: 2, AskLists: 1, AskUsage: 1, Restaurant: 2 } });
    expect(s.names()).toEqual(['Nonna (Midtown DC)']);
    expect(s.ids('Staff')).toEqual(['omar']);
    expect(s.loginsRemoved.sort()).toEqual(['dev.p', 'lena.k', 'priya.m', 'sam.t']);
    expect(s.ids('PushSubscription')).toEqual(['p-omar']);
    expect(s.ids('AskLists')).toEqual(['main']);
    expect(s.ids('AskUsage')).toEqual(['main:2026-11-20']);
    for (const kind of ['MenuItem', 'EightySixEvent', 'Vendor'] as const) expect(s.ids(kind), kind).toEqual([]);
  });

  it('remembers that it finished, so the tables are not read again every time the Staff screen opens', async () => {
    const s = site();
    await setUp(s.db, 'Nonna', SETUP);
    await removeSamples(s.db, s.logins, owner);
    expect((await s.db.restaurants())[0]).toMatchObject({ own: true, samplesGone: true });
    let reads = 0;
    const list = s.db.list;
    s.db.list = (kind) => (reads++, list(kind));
    expect((await whatGoes(s.db, owner, AFTER)).counts.Staff).toBe(0);
    expect(reads).toBe(0);
    // and a new name does not undo that
    expect(await setUp(s.db, 'Nonna (Midtown DC)', AFTER)).toMatchObject({ samplesGone: true, ownSince: SETUP });
  });

  it('does not touch what was made after the set-up, however often it is pressed', async () => {
    const s = site();
    await setUp(s.db, 'Nonna', SETUP);
    await removeSamples(s.db, s.logins, owner);
    s.tables.MenuItem.push({ id: 'main-calamari', restaurantId: 'main', createdAt: AFTER });
    s.tables.EightySixEvent.push({ id: 'real-86', restaurantId: 'main', createdAt: AFTER });
    s.tables.Staff.push({ id: 'new.server', restaurantId: 'main', role: 'server', createdAt: AFTER });
    s.tables.PushSubscription.push({ id: 'p-new', restaurantId: 'main', createdAt: AFTER });
    const again = await removeSamples(s.db, s.logins, owner);
    expect(again).toMatchObject({ done: true, left: 0 });
    expect(KINDS.every((k) => again.removed[k] === 0)).toBe(true);
    expect(s.ids('MenuItem')).toEqual(['main-calamari']);
    expect(s.ids('Staff')).toEqual(['omar', 'new.server']);
    expect(s.loginsRemoved).toHaveLength(4);
  });

  it('stops when its time is up, says how much is left, and carries on when called again', async () => {
    const s = site();
    await setUp(s.db, 'Nonna', SETUP);
    for (let i = 0; i < 30; i++) s.tables.EightySixEvent.push({ id: 'old' + i, restaurantId: 'water', createdAt: BEFORE });
    let now = 0;
    const slow = () => (now += 5_000); // every look at the clock: five seconds later
    const first = await removeSamples(s.db, s.logins, owner, slow, 18_000);
    expect(first.done).toBe(false);
    expect(first.left).toBeGreaterThan(0);
    let rounds = 1;
    for (let res = first; !res.done && rounds < 20; rounds++) res = await removeSamples(s.db, s.logins, owner, slow, 18_000);
    expect(rounds).toBeLessThan(20);
    expect(s.ids('EightySixEvent')).toEqual([]);
    expect(s.names()).toEqual(['Nonna']);
    expect(s.ids('Staff')).toEqual(['omar']);
  });
});
