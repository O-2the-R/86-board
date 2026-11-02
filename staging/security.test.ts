// The security test Ryan ran by hand, run against the staging copy on every
// push to the staging branch. Real logins, real API: each check signs in as
// a demo staff member and tries something that person must or must not be
// able to do. Staging only; it changes one item on Main Street and puts it
// back.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF } from '../shared/sample-data';
import { gql, loadOutputs, settingsProblem, subscribe, until, type Live, type Outputs } from './client';

// Who plays which part (demo logins from Load demo data).
const KITCHEN = 'marco.r'; // kitchen, Main Street
const MANAGER = 'priya.m'; // manager, Main Street
const SERVER = 'sam.t'; // server, Main Street
const OTHER_MANAGER = 'dev.p'; // manager, Waterfront
const OTHER_SERVER = 'zoe.f'; // server, Waterfront

const nameOf = (username: string) => STAFF.find((s) => s.username === username)?.displayName ?? username;

const ITEM_FIELDS = 'id restaurantId name status outSince note markedBy vendorNoteAt vendorNoteBy editors readers updatedAt';

interface Item {
  id: string;
  restaurantId: string;
  name: string;
  status: string;
  markedBy?: string | null;
  vendorNoteBy?: string | null;
}

const problem = settingsProblem();
let out: Outputs;
let item: Item; // the Main Street item the test 86's and brings back
let water: Item; // any Waterfront item

const getItem = async (id: string) => (await gql<{ getMenuItem: Item }>(out, MANAGER, `query($id: ID!) { getMenuItem(id: $id) { ${ITEM_FIELDS} } }`, { id })).data?.getMenuItem;

const change = (username: string, itemId: string, action: 'out' | 'low' | 'back', note?: string) =>
  gql(out, username, 'mutation($itemId: String!, $action: String!, $note: String) { changeItem(itemId: $itemId, action: $action, note: $note) }', { itemId, action, note });

const refused = (r: { data: unknown; errors: unknown[] }, field: string) => r.errors.length > 0 && !(r.data as Record<string, unknown> | null)?.[field];

describe.skipIf(problem)('staging: who can do what', () => {
  beforeAll(async () => {
    out = await loadOutputs();
    const main = await gql<{ listMenuItemByRestaurantId: { items: Item[] } }>(out, KITCHEN, `query { listMenuItemByRestaurantId(restaurantId: "main", limit: 500) { items { ${ITEM_FIELDS} } } }`);
    const pick = main.data?.listMenuItemByRestaurantId.items.find((i) => i.status === 'available');
    if (!pick) throw new Error('No available item on Main Street to test with. Press Load demo data on staging.');
    item = pick;
    const w = await gql<{ listMenuItemByRestaurantId: { items: Item[] } }>(out, OTHER_MANAGER, `query { listMenuItemByRestaurantId(restaurantId: "water", limit: 1) { items { ${ITEM_FIELDS} } } }`);
    const first = w.data?.listMenuItemByRestaurantId.items[0];
    if (!first) throw new Error('No Waterfront items on staging. Press Load demo data on staging.');
    water = first;
  });

  afterAll(async () => {
    // Leave the board as it was found.
    if (item) {
      const now = await getItem(item.id);
      if (now && now.status !== 'available') await change(KITCHEN, item.id, 'back');
    }
  });

  it('a server cannot change the board', async () => {
    expect(refused(await change(SERVER, item.id, 'out', 'test'), 'changeItem')).toBe(true);
    expect((await getItem(item.id))?.status).toBe('available');
  });

  it('a server cannot write to the database directly', async () => {
    const r = await gql(out, SERVER, 'mutation($id: ID!) { updateMenuItem(input: { id: $id, status: "out" }) { id } }', { id: item.id });
    expect(refused(r, 'updateMenuItem')).toBe(true);
  });

  it('kitchen cannot change another restaurant', async () => {
    expect(refused(await change(KITCHEN, water.id, 'out', 'test'), 'changeItem')).toBe(true);
  });

  it('a server sees only their own restaurant: board, history and staff', async () => {
    const items = await gql<{ listMenuItems: { items: Item[] } }>(out, SERVER, 'query { listMenuItems(limit: 1000) { items { id restaurantId } } }');
    expect(items.errors).toEqual([]);
    const seen = new Set(items.data?.listMenuItems.items.map((i) => i.restaurantId));
    expect([...seen]).toEqual(['main']);

    const other = await gql<{ listMenuItemByRestaurantId: { items: Item[] } }>(out, SERVER, 'query { listMenuItemByRestaurantId(restaurantId: "water", limit: 100) { items { id } } }');
    expect(other.data?.listMenuItemByRestaurantId.items ?? []).toEqual([]);

    const history = await gql<{ listEightySixEventByRestaurantIdAndStartedAt: { items: unknown[] } }>(
      out,
      SERVER,
      'query { listEightySixEventByRestaurantIdAndStartedAt(restaurantId: "water", limit: 100) { items { id } } }',
    );
    expect(history.data?.listEightySixEventByRestaurantIdAndStartedAt.items ?? []).toEqual([]);

    const staff = await gql<{ listStaff: { items: { restaurantId: string }[] } }>(out, SERVER, 'query { listStaff(limit: 1000) { items { restaurantId } } }');
    expect(staff.errors).toEqual([]);
    expect(new Set(staff.data?.listStaff.items.map((s) => s.restaurantId))).toEqual(new Set(['main']));
  });

  it('only the owner can load demo data or repair data', async () => {
    expect(refused(await gql(out, MANAGER, 'mutation { seedDemo(confirm: "LOAD") }'), 'seedDemo')).toBe(true);
    expect(refused(await gql(out, MANAGER, 'mutation { repairData(confirm: "REPAIR") }'), 'repairData')).toBe(true);
  });

  it("a manager cannot switch off another restaurant's staff", async () => {
    const r = await gql(out, MANAGER, 'mutation($u: String!) { manageStaff(action: "deactivate", username: $u) }', { u: OTHER_SERVER });
    if (!refused(r, 'manageStaff')) {
      await gql(out, MANAGER, 'mutation($u: String!) { manageStaff(action: "reactivate", username: $u) }', { u: OTHER_SERVER });
    }
    expect(refused(r, 'manageStaff')).toBe(true);
  });

  it('a server cannot manage staff at all', async () => {
    expect(refused(await gql(out, SERVER, 'mutation { manageStaff(action: "suggestUsername", username: "test") }'), 'manageStaff')).toBe(true);
  });

  describe('an 86, live, end to end', () => {
    let watcher: Live<Item>;
    let snoop: Live<Item> | null = null;
    let snoopRefused = false;

    beforeAll(async () => {
      const sub = (filter: boolean) =>
        filter
          ? `subscription($filter: ModelSubscriptionMenuItemFilterInput) { onUpdateMenuItem(filter: $filter) { ${ITEM_FIELDS} } }`
          : `subscription { onUpdateMenuItem { ${ITEM_FIELDS} } }`;
      watcher = await subscribe<Item>(out, MANAGER, sub(true), { filter: { restaurantId: { eq: 'main' } } }, 'onUpdateMenuItem');
      try {
        // A Waterfront manager asking for everything must not hear about Main Street.
        snoop = await subscribe<Item>(out, OTHER_MANAGER, sub(false), {}, 'onUpdateMenuItem');
      } catch {
        snoopRefused = true;
      }
    });

    afterAll(() => {
      watcher?.close();
      snoop?.close();
    });

    it('kitchen 86s it, and the name comes from the login', async () => {
      const r = await change(KITCHEN, item.id, 'out', 'Staging test');
      expect(r.errors).toEqual([]);
      const now = await getItem(item.id);
      expect(now?.status).toBe('out');
      expect(now?.markedBy).toBe(nameOf(KITCHEN));
    });

    it('a manager watching Main Street sees it within 5 seconds', async () => {
      expect(await until(() => watcher.received.some((i) => i.id === item.id && i.status === 'out'), 5_000)).toBe(true);
    });

    it('a manager at another restaurant hears nothing', async () => {
      await new Promise((r) => setTimeout(r, 2_000));
      expect(snoopRefused || !snoop?.received.some((i) => i.restaurantId === 'main')).toBe(true);
    });

    it('history opens an entry stamped with the same name', async () => {
      const h = await gql<{ listEightySixEventByRestaurantIdAndStartedAt: { items: { itemId: string; markedBy: string; endedAt: string | null }[] } }>(
        out,
        MANAGER,
        'query { listEightySixEventByRestaurantIdAndStartedAt(restaurantId: "main", sortDirection: DESC, limit: 20) { items { itemId markedBy endedAt } } }',
      );
      const open = h.data?.listEightySixEventByRestaurantIdAndStartedAt.items.find((e) => e.itemId === item.id);
      expect(open?.markedBy).toBe(nameOf(KITCHEN));
      expect(open?.endedAt).toBeNull();
    });

    it('a server cannot log a vendor note; the manager can', async () => {
      expect(refused(await gql(out, SERVER, 'mutation($id: String!) { logVendorNote(itemId: $id) }', { id: item.id }), 'logVendorNote')).toBe(true);
      expect(refused(await gql(out, KITCHEN, 'mutation { saveVendor(restaurantId: "main", name: "Test", email: "test@example.com") }'), 'saveVendor')).toBe(true);
      const ok = await gql(out, MANAGER, 'mutation($id: String!) { logVendorNote(itemId: $id) }', { id: item.id });
      expect(ok.errors).toEqual([]);
      expect((await getItem(item.id))?.vendorNoteBy).toBe(nameOf(MANAGER));
    });

    it('back on closes the history entry and clears the vendor note', async () => {
      expect((await change(KITCHEN, item.id, 'back')).errors).toEqual([]);
      const now = await getItem(item.id);
      expect(now?.status).toBe('available');
      expect(now?.vendorNoteBy ?? null).toBeNull();
      const h = await gql<{ listEightySixEventByRestaurantIdAndStartedAt: { items: { itemId: string; endedAt: string | null; clearedBy: string | null }[] } }>(
        out,
        MANAGER,
        'query { listEightySixEventByRestaurantIdAndStartedAt(restaurantId: "main", sortDirection: DESC, limit: 20) { items { itemId endedAt clearedBy } } }',
      );
      const last = h.data?.listEightySixEventByRestaurantIdAndStartedAt.items.find((e) => e.itemId === item.id);
      expect(last?.endedAt).toBeTruthy();
      expect(last?.clearedBy).toBe(nameOf(KITCHEN));
      expect(await until(() => watcher.received.some((i) => i.id === item.id && i.status === 'available'), 5_000)).toBe(true);
    });
  });

  it('the morning report link refuses a request without the key', async () => {
    const url = out.custom?.reportUrl;
    expect(url).toBeTruthy();
    const res = await fetch(`${url!.replace(/\/$/, '')}/report`);
    expect(res.status).toBe(401);
  });
});

// Without the settings the suite cannot run; say so instead of passing quietly.
describe.runIf(problem)('staging settings', () => {
  it('are present', () => {
    expect(problem).toBeNull();
  });
});
