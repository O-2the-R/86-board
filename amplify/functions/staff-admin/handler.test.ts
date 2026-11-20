// manageSite end to end, with a pretend database and pretend logins in
// memory. No AWS: what is checked here is the function's own wiring (who
// may, which tables it reads page by page, what it removes, what it never
// touches), and that "already gone" answers do not stop it. The rules
// themselves are tested one by one in site.test.ts.
import { describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };

const fake = vi.hoisted(() => {
  const tables: Record<string, Map<string, Row>> = {};
  const table = (name: string) => (tables[name] ??= new Map());
  // the real table's answer when a row is not in the state a change needs
  const CONDITION = { errors: [{ message: 'The conditional request failed (Service: DynamoDb, Status Code: 400)', errorType: 'DynamoDB:ConditionalCheckFailedException' }] };
  class UserNotFound extends Error {}
  class UsernameExists extends Error {}
  const PAGE = 50; // tables come back in pages, like the real ones
  const state = {
    tables,
    table,
    UserNotFound,
    UsernameExists,
    logins: new Set<string>(),
    loginsRemoved: [] as string[],
    stale: {} as Record<string, Row[]>, // rows a listing still shows although they are gone
    fields: {} as Record<string, string[]>, // the fields each listing asked for
    refuseDelete: '', // a table whose deletes fail for a real reason
    model: (name: string) => ({
      get: async ({ id }: { id: string }) => ({ data: table(name).get(id) ?? null }),
      create: async (row: Row) => {
        if (table(name).has(row.id)) return { data: null, ...CONDITION };
        table(name).set(row.id, { ...row });
        return { data: row };
      },
      update: async (row: Row) => {
        const now = table(name).get(row.id);
        if (!now) return { data: null, ...CONDITION };
        Object.assign(now, row);
        return { data: now };
      },
      delete: async ({ id }: { id: string }) => {
        if (state.refuseDelete === name) return { data: null, errors: [{ message: `Not Authorized to access delete${name} on type Mutation`, errorType: 'Unauthorized' }] };
        if (!table(name).has(id)) return { data: null, ...CONDITION };
        table(name).delete(id);
        return { data: { id } };
      },
      list: async (options: { nextToken?: string; selectionSet?: string[] } = {}) => {
        if (options.selectionSet) state.fields[name] = options.selectionSet;
        const all = [...table(name).values(), ...(state.stale[name] ?? [])];
        const from = Number(options.nextToken ?? 0);
        return { data: all.slice(from, from + PAGE).map((r) => ({ ...r })), nextToken: from + PAGE < all.length ? String(from + PAGE) : null };
      },
    }),
  };
  return state;
});

const KINDS = ['Staff', 'MenuItem', 'EightySixEvent', 'Vendor', 'PushSubscription', 'AskLists', 'AskUsage', 'Restaurant'];

vi.mock('$amplify/env/staff-admin', () => ({ env: {} }));
vi.mock('@aws-amplify/backend/function/runtime', () => ({ getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }) }));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => undefined } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({ models: Object.fromEntries(['Staff', 'MenuItem', 'EightySixEvent', 'Vendor', 'PushSubscription', 'AskLists', 'AskUsage', 'Restaurant'].map((name) => [name, fake.model(name)])) }),
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class Command {
    constructor(public input: { Username?: string }) {}
  }
  class AdminDeleteUserCommand extends Command {}
  return {
    CognitoIdentityProviderClient: class {
      send = async (command: Command) => {
        if (!(command instanceof AdminDeleteUserCommand)) throw new Error('This test only removes logins.');
        const username = command.input.Username ?? '';
        if (!fake.logins.delete(username)) throw new fake.UserNotFound(`No login ${username}`);
        fake.loginsRemoved.push(username);
        return {};
      };
    },
    AdminDeleteUserCommand,
    AdminAddUserToGroupCommand: class extends Command {},
    AdminCreateUserCommand: class extends Command {},
    AdminDisableUserCommand: class extends Command {},
    AdminEnableUserCommand: class extends Command {},
    AdminGetUserCommand: class extends Command {},
    AdminSetUserPasswordCommand: class extends Command {},
    AdminUserGlobalSignOutCommand: class extends Command {},
    UserNotFoundException: fake.UserNotFound,
    UsernameExistsException: fake.UsernameExists,
  };
});

const OWNER = { username: 'omar', groups: ['owner'] };
const MANAGER = { username: 'priya.m', groups: ['main-manager'] };
const BEFORE = '2020-01-01T12:00:00.000Z'; // when the samples were loaded
const LATER = '2999-01-01T12:00:00.000Z'; // real data, made after the set-up

type Handler = (event: never) => Promise<unknown>;
type Who = { username: string; groups: string[] };
interface Status {
  own: { id: string; name: string } | null;
  locked: boolean;
  toRemove: Record<string, number>;
}
interface Removed {
  done: boolean;
  left: number;
  removed: Record<string, number>;
}

const site = <T>(handler: Handler, who: Who, action: string, name?: string) => handler({ identity: who, arguments: { action, name }, info: { fieldName: 'manageSite' } } as never) as Promise<T>;

// A site as "Load demo data" leaves it, in memory, and a handler started on it.
async function boot(settings: Record<string, string> = {}): Promise<Handler> {
  for (const name of Object.keys(fake.tables)) fake.tables[name].clear();
  fake.logins.clear();
  fake.loginsRemoved.length = 0;
  fake.stale = {};
  fake.fields = {};
  fake.refuseDelete = '';
  const put = (kind: string, id: string, more: Record<string, unknown> = {}) => fake.table(kind).set(id, { id, createdAt: BEFORE, ...more });
  put('Restaurant', 'main', { name: 'Main Street', kind: 'Full service', sortOrder: 0 });
  put('Restaurant', 'water', { name: 'Waterfront', kind: 'Full service', sortOrder: 1 });
  put('Restaurant', 'counter', { name: 'The Counter', kind: 'Fast casual', sortOrder: 2 });
  put('Staff', 'omar', { restaurantId: 'all', role: 'owner' });
  for (const [username, restaurantId, role] of [['priya.m', 'main', 'manager'], ['sam.t', 'main', 'server'], ['dev.p', 'water', 'manager'], ['lena.k', 'counter', 'host']]) put('Staff', username, { restaurantId, role });
  for (const username of ['omar', 'priya.m', 'sam.t', 'dev.p', 'lena.k']) fake.logins.add(username);
  for (const [id, restaurantId] of [['main-tiramisu', 'main'], ['main-caesar', 'main'], ['water-oysters', 'water'], ['counter-fries', 'counter']]) put('MenuItem', id, { restaurantId });
  for (let i = 0; i < 120; i++) put('EightySixEvent', `e${i}`, { restaurantId: ['main', 'water', 'counter'][i % 3] }); // more than two pages
  put('Vendor', 'main-capital-meats', { restaurantId: 'main' });
  put('Vendor', 'water-fish', { restaurantId: 'water' });
  put('PushSubscription', 'p-omar', { restaurantId: 'all' });
  put('PushSubscription', 'p-sam', { restaurantId: 'main' });
  put('AskLists', 'water', { restaurantId: 'water' });
  put('AskUsage', 'counter:2026-11-19', { restaurantId: 'counter' });
  vi.resetModules();
  delete process.env.SITE_SETUP;
  Object.assign(process.env, settings);
  return (await import('./handler')).handler as unknown as Handler;
}

const ids = (kind: string) => [...fake.table(kind).keys()].sort();

// Set up, with the owner's lists loaded in between, as the screen does it.
async function setUpAs(handler: Handler, name: string) {
  const out = await site<{ own: { id: string; name: string } }>(handler, OWNER, 'setUp', name);
  fake.table('AskLists').set('main', { id: 'main', restaurantId: 'main', createdAt: LATER });
  return out;
}

describe('the site, from the samples to one real restaurant', () => {
  it('is the owner\'s alone', async () => {
    const handler = await boot();
    for (const action of ['status', 'setUp', 'removeSamples']) await expect(site(handler, MANAGER, action, 'Mine')).rejects.toThrow('Owner only.');
    expect(ids('Restaurant')).toEqual(['counter', 'main', 'water']);
  });

  it('counts what the set-up would remove, reading every table page by page', async () => {
    const handler = await boot();
    const status = await site<Status>(handler, OWNER, 'status');
    expect(status).toMatchObject({ own: null, locked: false });
    // every login but the owner's, every sample row, the two other restaurants
    expect(status.toRemove).toEqual({ Staff: 4, MenuItem: 4, EightySixEvent: 120, Vendor: 2, PushSubscription: 1, AskLists: 1, AskUsage: 1, Restaurant: 2 });
    // each listing asks for what the rules need to decide, nothing private
    for (const kind of KINDS) expect(fake.fields[kind]).toEqual(expect.arrayContaining(['id', 'createdAt']));
    expect(fake.fields.AskLists).not.toContain('body');
  });

  it('names the restaurant and marks it as the owner\'s own', async () => {
    const handler = await boot();
    expect(await site(handler, OWNER, 'setUp', '  Pepe   (Harbor Road) ')).toEqual({ ok: true, own: { id: 'main', name: 'Pepe (Harbor Road)' } });
    expect(fake.table('Restaurant').get('main')).toMatchObject({ name: 'Pepe (Harbor Road)', own: true, samplesGone: false, ownSince: expect.any(String) });
    expect((await site<Status>(handler, OWNER, 'status')).own).toEqual({ id: 'main', name: 'Pepe (Harbor Road)' });
    await expect(site(handler, OWNER, 'setUp', ' ')).rejects.toThrow('Type the name of your restaurant.');
  });

  it('will not remove anything before the restaurant is set up', async () => {
    const handler = await boot();
    await expect(site(handler, OWNER, 'removeSamples')).rejects.toThrow('Set up your restaurant first.');
    expect(ids('Staff')).toHaveLength(5);
  });

  it('removes the samples and every login but the owner\'s, and keeps what is the owner\'s', async () => {
    const handler = await boot();
    await setUpAs(handler, 'Pepe');
    const out = await site<Removed>(handler, OWNER, 'removeSamples');
    expect(out).toMatchObject({ ok: true, done: true, left: 0 });
    expect(out.removed).toEqual({ Staff: 4, MenuItem: 4, EightySixEvent: 120, Vendor: 2, PushSubscription: 1, AskLists: 1, AskUsage: 1, Restaurant: 2 });
    expect(ids('Restaurant')).toEqual(['main']);
    expect(ids('Staff')).toEqual(['omar']);
    expect([...fake.logins]).toEqual(['omar']);
    expect(fake.loginsRemoved.sort()).toEqual(['dev.p', 'lena.k', 'priya.m', 'sam.t']);
    expect(ids('PushSubscription')).toEqual(['p-omar']);
    expect(ids('AskLists')).toEqual(['main']); // the owner's own lists
    for (const kind of ['MenuItem', 'EightySixEvent', 'Vendor', 'AskUsage']) expect(ids(kind)).toEqual([]);
    expect(fake.table('Restaurant').get('main')).toMatchObject({ name: 'Pepe', own: true, samplesGone: true });
  });

  it('never touches what was made after the set-up, however often it is pressed', async () => {
    const handler = await boot();
    await setUpAs(handler, 'Pepe');
    await site(handler, OWNER, 'removeSamples');
    fake.table('MenuItem').set('main-calamari', { id: 'main-calamari', restaurantId: 'main', createdAt: LATER });
    fake.table('Staff').set('marco.r', { id: 'marco.r', restaurantId: 'main', role: 'kitchen', createdAt: LATER });
    fake.logins.add('marco.r');
    expect(await site<Removed>(handler, OWNER, 'removeSamples')).toMatchObject({ done: true, left: 0 });
    expect(await site<Status>(handler, OWNER, 'status')).toMatchObject({ toRemove: { Staff: 0, MenuItem: 0 } });
    expect(ids('MenuItem')).toEqual(['main-calamari']);
    expect(ids('Staff')).toEqual(['marco.r', 'omar']);
    expect([...fake.logins].sort()).toEqual(['marco.r', 'omar']);
  });

  it('is not stopped by a listing that is a beat behind, or by a login that is already gone', async () => {
    const handler = await boot();
    await setUpAs(handler, 'Pepe');
    // rows the last round removed, still listed; and a staff row whose login is gone
    fake.stale = { MenuItem: [{ id: 'water-crab', restaurantId: 'water', createdAt: BEFORE }], Staff: [{ id: 'zoe.f', restaurantId: 'water', role: 'server', createdAt: BEFORE }] };
    fake.logins.delete('sam.t');
    const out = await site<Removed>(handler, OWNER, 'removeSamples');
    expect(out).toMatchObject({ done: true, left: 0 });
    expect(ids('Staff')).toEqual(['omar']);
    expect(ids('Restaurant')).toEqual(['main']);
  });

  it('still fails loudly on a real database error, and carries on when pressed again', async () => {
    const handler = await boot();
    await setUpAs(handler, 'Pepe');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.refuseDelete = 'Vendor';
    await expect(site(handler, OWNER, 'removeSamples')).rejects.toThrow(/Removing Vendor .*Not Authorized/);
    quiet.mockRestore();
    expect(fake.table('Restaurant').get('main')).toMatchObject({ samplesGone: false });
    fake.refuseDelete = '';
    expect(await site<Removed>(handler, OWNER, 'removeSamples')).toMatchObject({ done: true, left: 0 });
    expect(ids('Vendor')).toEqual([]);
    expect(ids('Restaurant')).toEqual(['main']);
  });

  it('refuses demo data once the site has its own restaurant', async () => {
    const handler = await boot();
    await setUpAs(handler, 'Pepe');
    await expect(handler({ identity: OWNER, arguments: { confirm: 'LOAD' }, info: { fieldName: 'seedDemo' } } as never)).rejects.toThrow('This site has its own restaurant now.');
  });

  it('is switched off on the staging copy, which only counts', async () => {
    const handler = await boot({ SITE_SETUP: 'off' });
    expect(await site<Status>(handler, OWNER, 'status')).toMatchObject({ own: null, locked: true, toRemove: { Staff: 4, Restaurant: 2 } });
    for (const action of ['setUp', 'removeSamples']) await expect(site(handler, OWNER, action, 'Pepe')).rejects.toThrow('This is the staging copy.');
    expect(fake.table('Restaurant').get('main')).toMatchObject({ name: 'Main Street' });
    expect(ids('Staff')).toHaveLength(5);
    delete process.env.SITE_SETUP;
  });
});
