// "Set up your own restaurant": what it does to the data. A new site starts
// with three sample restaurants and 60 demo logins. The owner can turn it
// into one real restaurant: name it, then remove everything that was there
// before. The database and the login system are passed in, so the tests run
// all of this in memory.
//
// The real restaurant always lives in the first slot ("main"). Slots are
// only ids: they decide which login groups belong to a restaurant. The name
// people see is data on the restaurant's row.
import { RESTAURANT_IDS } from '../../../shared/sample-data';
import { Refused, type Actor } from './rules';

export const OWN_SLOT = RESTAURANT_IDS[0];

export type Kind = 'Staff' | 'MenuItem' | 'EightySixEvent' | 'Vendor' | 'PushSubscription' | 'AskLists' | 'AskUsage' | 'Restaurant';
// the order things are removed in: people first, the restaurants themselves last
export const KINDS: Kind[] = ['Staff', 'MenuItem', 'EightySixEvent', 'Vendor', 'PushSubscription', 'AskLists', 'AskUsage', 'Restaurant'];

export interface Row {
  id: string;
  restaurantId?: string | null;
  role?: string | null;
  createdAt?: string | null;
}

export interface RestaurantRow {
  id: string;
  name: string;
  kind: string;
  sortOrder?: number | null;
  own?: boolean | null;
  ownSince?: string | null;
  samplesGone?: boolean | null; // the clean-up finished: nothing is left to look for
}

export interface SiteDb {
  restaurants(): Promise<RestaurantRow[]>;
  saveRestaurant(row: RestaurantRow, isNew: boolean): Promise<void>;
  list(kind: Kind): Promise<Row[]>; // every row of one table
  remove(kind: Kind, id: string): Promise<void>; // fine when the row is already gone
}

export interface Logins {
  remove(username: string): Promise<void>; // fine when the login is already gone
}

export const ownOf = (restaurants: RestaurantRow[]): RestaurantRow | undefined => restaurants.find((r) => r.own === true);

// Names the restaurant and marks it as the owner's own. Saying it again
// renames it; the moment it became the owner's own stays as it was.
export async function setUp(db: SiteDb, name: string | null | undefined, now: string): Promise<RestaurantRow> {
  const clean = (name ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < 2) throw new Refused('Type the name of your restaurant.');
  if (clean.length > 40) throw new Refused('Keep the name under 40 characters.');
  const restaurants = await db.restaurants();
  const there = restaurants.find((r) => r.id === OWN_SLOT);
  const again = there?.own === true;
  const row: RestaurantRow = { id: OWN_SLOT, name: clean, kind: again ? there.kind : 'Restaurant', sortOrder: 0, own: true, ownSince: again && there.ownSince ? there.ownSince : now, samplesGone: again && there.samplesGone === true };
  await db.saveRestaurant(row, !there);
  return row;
}

// Does this row go when the samples are removed? Everything at the other
// slots goes. At the owner's own slot, only what was there before it became
// their own: so pressing the button again later never touches real data.
// The owner, and anything filed under "all" restaurants, always stays.
export function goes(kind: Kind, row: Row, ownSince: string, actor: Actor): boolean {
  const old = !row.createdAt || row.createdAt < ownSince;
  const elsewhere = row.restaurantId !== OWN_SLOT;
  switch (kind) {
    case 'Staff':
      if (row.role === 'owner' || row.restaurantId === 'all' || row.id === actor.username) return false;
      return elsewhere || old;
    case 'PushSubscription':
      if (row.restaurantId === 'all') return false;
      return elsewhere || old;
    case 'MenuItem':
    case 'EightySixEvent':
    case 'Vendor':
      return elsewhere || old;
    case 'AskLists':
    case 'AskUsage':
      return elsewhere; // the owner's own lists were loaded before the set-up, and stay
    case 'Restaurant':
      return row.id !== OWN_SLOT;
  }
}

export type Counts = Record<Kind, number>;
const noCounts = (): Counts => ({ Staff: 0, MenuItem: 0, EightySixEvent: 0, Vendor: 0, PushSubscription: 0, AskLists: 0, AskUsage: 0, Restaurant: 0 });

// What "remove the samples" would take away right now. Before the set-up
// that is everything but the owner (the set-up moment would be now).
export async function whatGoes(db: SiteDb, actor: Actor, now: string): Promise<{ own: RestaurantRow | undefined; rows: Record<Kind, Row[]>; counts: Counts }> {
  const own = ownOf(await db.restaurants());
  const since = own?.ownSince ?? now;
  const counts = noCounts();
  const rows = {} as Record<Kind, Row[]>;
  for (const kind of KINDS) {
    // Once the clean-up has finished there is nothing to find, and no reason
    // to read every table each time the owner opens the Staff screen.
    rows[kind] = own?.samplesGone ? [] : (await db.list(kind)).filter((row) => goes(kind, row, since, actor));
    counts[kind] = rows[kind].length;
  }
  return { own, rows, counts };
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>, carryOn: () => boolean): Promise<number> {
  let done = 0;
  for (let i = 0; i < items.length && carryOn(); i += size) {
    const batch = items.slice(i, i + size);
    await Promise.all(batch.map(fn));
    done += batch.length;
  }
  return done;
}

// Removes the sample restaurants, their menus, history and vendor contacts,
// and every login but the owner's. Works for a set time and then says how far
// it got; calling it again carries on, so a busy database cannot leave it
// half done for good.
export async function removeSamples(db: SiteDb, logins: Logins, actor: Actor, clock: () => number = Date.now, budgetMs = 18_000): Promise<{ done: boolean; removed: Counts; left: number }> {
  const started = clock();
  const { own, rows, counts } = await whatGoes(db, actor, new Date(started).toISOString());
  if (!own) throw new Refused('Set up your restaurant first.');
  const carryOn = () => clock() - started < budgetMs;
  const removed = noCounts();
  for (const kind of KINDS) {
    removed[kind] = await inBatches(
      rows[kind],
      8,
      async (row) => {
        if (kind === 'Staff') await logins.remove(row.id);
        await db.remove(kind, row.id);
      },
      carryOn,
    );
  }
  const total = KINDS.reduce((n, k) => n + counts[k], 0);
  const gone = KINDS.reduce((n, k) => n + removed[k], 0);
  const done = gone === total;
  if (done && !own.samplesGone) await db.saveRestaurant({ ...own, samplesGone: true }, false);
  return { done, removed, left: total - gone };
}
