// syncMenu end to end, with a pretend database in memory. No AWS: what is
// checked here is the function's own wiring (who may, what it reads, what it
// writes and in which order), and that the database's "already gone" and
// "already there" answers do not stop it.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editorGroupsFor, readersFor } from '../../../shared/sample-data';

type Row = Record<string, unknown> & { id: string };

const fake = vi.hoisted(() => {
  const tables: Record<string, Map<string, Row>> = {};
  const table = (name: string) => (tables[name] ??= new Map());
  // the real table's answer when a row is not in the state a change needs
  const CONDITION = { errors: [{ message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)', errorType: 'DynamoDB:ConditionalCheckFailedException' }] };
  const calls: string[] = [];
  const model = (name: string) => ({
    get: async ({ id }: { id: string }) => ({ data: table(name).get(id) ?? null }),
    create: async (row: Row) => {
      calls.push(`create ${name} ${row.id}`);
      if (table(name).has(row.id)) return { data: null, ...CONDITION };
      table(name).set(row.id, { ...row });
      return { data: row };
    },
    update: async (row: Row) => {
      calls.push(`update ${name} ${row.id}`);
      const now = table(name).get(row.id);
      if (!now) return { data: null, ...CONDITION };
      Object.assign(now, row);
      return { data: now };
    },
    delete: async ({ id }: { id: string }) => {
      calls.push(`delete ${name} ${id}`);
      if (!table(name).has(id)) return { data: null, ...CONDITION };
      table(name).delete(id);
      return { data: { id } };
    },
  });
  const PAGE = 50; // the board comes back in pages, like the real one
  const state = {
    tables,
    table,
    calls,
    stale: [] as Row[], // rows the board listing still shows although they are gone
    client: {
      models: {
        AskLists: model('AskLists'),
        Staff: model('Staff'),
        Vendor: model('Vendor'),
        MenuItem: {
          ...model('MenuItem'),
          listMenuItemByRestaurantId: async ({ restaurantId }: { restaurantId: string }, options: { nextToken?: string }) => {
            const all = [...table('MenuItem').values(), ...state.stale].filter((r) => r.restaurantId === restaurantId);
            const from = Number(options.nextToken ?? 0);
            return { data: all.slice(from, from + PAGE).map((r) => ({ ...r })), nextToken: from + PAGE < all.length ? String(from + PAGE) : null };
          },
        },
        EightySixEvent: {
          ...model('EightySixEvent'),
          listEightySixEventByRestaurantIdAndStartedAt: async ({ restaurantId }: { restaurantId: string }) => ({
            data: [...table('EightySixEvent').values()].filter((r) => r.restaurantId === restaurantId),
            nextToken: null,
          }),
        },
      },
    },
  };
  return state;
});

vi.mock('$amplify/env/board', () => ({ env: {} }));
vi.mock('@aws-amplify/backend/function/runtime', () => ({ getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }) }));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => undefined } }));
vi.mock('aws-amplify/data', () => ({ generateClient: () => fake.client }));

const OWNER = { username: 'omar', groups: ['owner'] };
const MANAGER = { username: 'priya.m', groups: ['main-manager'] };

type Handler = (event: never) => Promise<unknown>;
interface Synced {
  ok: boolean;
  total: number;
  created: number;
  updated: number;
  removed: number;
}

const sync = (handler: Handler, who: { username: string; groups: string[] }, restaurantId: string) =>
  handler({ identity: who, arguments: { restaurantId }, info: { fieldName: 'syncMenu' } } as never) as Promise<Synced>;

type ListItem = { name: string; kind: 'food' | 'drink' | 'wine'; section: string; board?: string };
const LISTS: ListItem[] = [
  { name: 'Calamari', kind: 'food', section: 'Antipasti' },
  { name: 'Tiramisu', kind: 'food', section: 'Dessert' },
  { name: 'Negroni', kind: 'drink', section: 'Negronis' },
  { name: 'Chianti', kind: 'wine', section: 'Red' },
];
const loadLists = (restaurantId: string, items: ListItem[]) => fake.table('AskLists').set(restaurantId, { id: restaurantId, restaurantId, staffCanUse: false, body: JSON.stringify({ name: 'Pepe', items }) });
const menuItem = (id: string, restaurantId: string, name: string, more: Record<string, unknown> = {}): Row => ({ id, restaurantId, name, category: 'Mains', sortOrder: 0, status: 'available', ...more });
const board = (restaurantId: string) =>
  [...fake.table('MenuItem').values()]
    .filter((r) => r.restaurantId === restaurantId)
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
    .map((r) => `${String(r.name)} | ${String(r.category)} | ${String(r.status)}`);

let handler: Handler;

beforeEach(async () => {
  for (const name of Object.keys(fake.tables)) fake.tables[name].clear();
  fake.calls.length = 0;
  fake.stale = [];
  fake.table('Staff').set('omar', { id: 'omar', displayName: 'Omar' });
  vi.resetModules();
  handler = (await import('./handler')).handler as unknown as Handler;
});

describe('putting the lists on the 86 board', () => {
  it('is the owner\'s alone', async () => {
    loadLists('main', LISTS);
    await expect(sync(handler, MANAGER, 'main')).rejects.toThrow('Owner only.');
    expect(fake.table('MenuItem').size).toBe(0);
  });

  it('needs lists to be loaded first, and says so', async () => {
    await expect(sync(handler, OWNER, 'main')).rejects.toThrow('Load lists for this restaurant first. The board menu comes from them.');
  });

  it('says so when the stored lists cannot be read', async () => {
    fake.table('AskLists').set('main', { id: 'main', restaurantId: 'main', body: '{ not json' });
    await expect(sync(handler, OWNER, 'main')).rejects.toThrow('The stored lists cannot be read. Load them again.');
  });

  it('fills an empty board: every item, in the lists\' order, available, readable by that restaurant\'s staff', async () => {
    loadLists('main', LISTS);
    expect(await sync(handler, OWNER, 'main')).toEqual({ ok: true, total: 4, created: 4, updated: 0, removed: 0 });
    expect(board('main')).toEqual(['Calamari | Antipasti | available', 'Tiramisu | Dessert | available', 'Negroni | Drinks: Negronis | available', 'Chianti | Wine: Red | available']);
    expect(fake.table('MenuItem').get('main-calamari')).toMatchObject({ restaurantId: 'main', editors: editorGroupsFor('main'), readers: readersFor('main') });
  });

  it('leaves another restaurant\'s board alone', async () => {
    loadLists('main', LISTS);
    fake.table('MenuItem').set('water-oysters', menuItem('water-oysters', 'water', 'Oysters'));
    await sync(handler, OWNER, 'main');
    expect(board('water')).toEqual(['Oysters | Mains | available']);
  });

  it('reads a long board page by page, so a second run finds nothing to do', async () => {
    const long = Array.from({ length: 133 }, (_, i): ListItem => ({ name: `Dish ${i + 1}`, kind: 'food', section: 'Menu' }));
    loadLists('main', long);
    expect(await sync(handler, OWNER, 'main')).toMatchObject({ total: 133, created: 133 });
    expect(await sync(handler, OWNER, 'main')).toEqual({ ok: true, total: 133, created: 0, updated: 0, removed: 0 });
    expect(fake.table('MenuItem').size).toBe(133);
  });

  it('follows new lists: adds what is new, keeps the state of what stays, removes what is gone', async () => {
    loadLists('main', LISTS);
    fake.table('MenuItem').set('main-tiramisu', menuItem('main-tiramisu', 'main', 'Tiramisu', { category: 'Desserts', sortOrder: 9, status: 'low', lowCount: 3 }));
    fake.table('MenuItem').set('main-short-rib', menuItem('main-short-rib', 'main', 'Short Rib', { sortOrder: 2 }));
    expect(await sync(handler, OWNER, 'main')).toEqual({ ok: true, total: 4, created: 3, updated: 1, removed: 1 });
    expect(board('main')).toEqual(['Calamari | Antipasti | available', 'Tiramisu | Dessert | low', 'Negroni | Drinks: Negronis | available', 'Chianti | Wine: Red | available']);
    expect(fake.table('MenuItem').get('main-tiramisu')).toMatchObject({ lowCount: 3 });
    // what is gone leaves before anything is added
    expect(fake.calls[0]).toBe('delete MenuItem main-short-rib');
  });

  it('closes the history entry of an 86\'d item that leaves the board, under the owner\'s name', async () => {
    loadLists('main', LISTS);
    fake.table('MenuItem').set('main-short-rib', menuItem('main-short-rib', 'main', 'Short Rib', { status: 'out', openEventId: 'e1' }));
    fake.table('MenuItem').set('main-halibut', menuItem('main-halibut', 'main', 'Halibut', { status: 'out' })); // an older row: no pointer to its entry
    fake.table('EightySixEvent').set('e1', { id: 'e1', restaurantId: 'main', itemId: 'main-short-rib', startedAt: '2026-11-20T18:00:00.000Z' });
    fake.table('EightySixEvent').set('e2', { id: 'e2', restaurantId: 'main', itemId: 'main-halibut', startedAt: '2026-11-20T19:00:00.000Z' });
    await sync(handler, OWNER, 'main');
    expect(fake.table('EightySixEvent').get('e1')).toMatchObject({ clearedBy: 'Omar', endedAt: expect.any(String) });
    expect(fake.table('EightySixEvent').get('e2')).toMatchObject({ clearedBy: 'Omar', endedAt: expect.any(String) });
    expect(fake.table('MenuItem').has('main-short-rib')).toBe(false);
    expect(fake.table('MenuItem').has('main-halibut')).toBe(false);
  });

  it('is not stopped by a board listing that is a beat behind', async () => {
    loadLists('main', LISTS);
    // Both rows were removed a moment ago (the samples), yet the listing still shows them.
    fake.stale = [menuItem('main-burger', 'main', 'Burger'), menuItem('main-tiramisu', 'main', 'Tiramisu', { category: 'Desserts', sortOrder: 9 })];
    expect(await sync(handler, OWNER, 'main')).toMatchObject({ ok: true, total: 4 });
    expect(board('main')).toEqual(['Calamari | Antipasti | available', 'Tiramisu | Dessert | available', 'Negroni | Drinks: Negronis | available', 'Chianti | Wine: Red | available']);
    expect(fake.calls).toContain('delete MenuItem main-burger'); // already gone: fine
    expect(fake.calls).toContain('update MenuItem main-tiramisu'); // gone: added afresh instead
  });

  it('brings a row in line when someone else added it a moment ago', async () => {
    loadLists('main', LISTS);
    const real = fake.client.models.MenuItem.listMenuItemByRestaurantId;
    // the first reading of the board misses a row that is there
    fake.table('MenuItem').set('main-negroni', menuItem('main-negroni', 'main', 'Negroni', { category: 'Bar', sortOrder: 40, status: 'out' }));
    fake.client.models.MenuItem.listMenuItemByRestaurantId = async () => ({ data: [], nextToken: null });
    try {
      await sync(handler, OWNER, 'main');
    } finally {
      fake.client.models.MenuItem.listMenuItemByRestaurantId = real;
    }
    expect(board('main')).toEqual(['Calamari | Antipasti | available', 'Tiramisu | Dessert | available', 'Negroni | Drinks: Negronis | out', 'Chianti | Wine: Red | available']);
  });

  it('still fails loudly on a real database error', async () => {
    loadLists('main', LISTS);
    const real = fake.client.models.MenuItem.create;
    fake.client.models.MenuItem.create = async () => ({ data: null, errors: [{ message: 'Not Authorized to access createMenuItem on type Mutation', errorType: 'Unauthorized' }] });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(sync(handler, OWNER, 'main')).rejects.toThrow(/Adding .*Not Authorized/);
    } finally {
      fake.client.models.MenuItem.create = real;
      quiet.mockRestore();
    }
  });
});
