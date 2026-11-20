// Runs behind changeItem, repairData, saveVendor, logVendorNote and syncMenu. The only
// code that writes to the board tables, so "who may change what" and "keep
// the history in step" live in one place and are checked on the server, not
// in the app.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import { env } from '$amplify/env/board';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { editorGroupsFor, readersFor, vendorIdFor, vendorReadersFor } from '../../../shared/sample-data';
import { canSendVendorNote, looksLikeEmail } from '../../../shared/vendor-note';
import { applyMenu, menuFromLists, planMenu, type BoardRow, type MenuDb } from '../../../shared/menu';
import { conditionFailed } from '../../../shared/conditional';
import type { AssistantCatalog } from '../../../shared/assistant/catalog';
import { Refused, canEditItem, parseAction, plan, type ItemState } from './transitions';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

interface Actor {
  username: string;
  groups: string[];
}

function actorFrom(event: AppSyncResolverEvent<unknown>): Actor {
  const id = event.identity as AppSyncIdentityCognito | null;
  if (!id || !('username' in id) || !id.username) throw new Refused('Sign in first.');
  return { username: id.username, groups: id.groups ?? [] };
}

function firstError(res: { errors?: { message: string }[] | undefined }, what: string) {
  if (res.errors?.length) throw new Error(`${what}: ${res.errors.map((e) => e.message).join('; ')}`);
}

// The name that goes on the board and in the history: the Staff record's
// display name, never whatever the phone sent.
async function displayNameOf(username: string): Promise<string> {
  const got = await client.models.Staff.get({ id: username });
  return got.data?.displayName ?? username;
}

// Walks a restaurant's history newest-first until it finds the entry that
// is still open for this item. Pages, so a busy restaurant cannot hide it.
async function findOpenEvent(restaurantId: string, itemId: string): Promise<string | null> {
  let nextToken: string | null | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await client.models.EightySixEvent.listEightySixEventByRestaurantIdAndStartedAt(
      { restaurantId },
      { sortDirection: 'DESC', limit: 200, nextToken: nextToken ?? undefined },
    );
    firstError(res, 'Reading the history');
    const hit = res.data.find((e) => e.itemId === itemId && !e.endedAt);
    if (hit) return hit.id;
    nextToken = res.nextToken;
    if (!nextToken) break;
  }
  return null;
}

async function closeEvent(id: string, now: string, by: string) {
  const res = await client.models.EightySixEvent.update({ id, endedAt: now, clearedBy: by });
  firstError(res, 'Closing the history entry');
}

// ---------- changeItem ----------

interface ChangeArgs {
  itemId: string;
  action: string;
  note?: string | null;
  count?: number | null;
}

async function changeItem(actor: Actor, args: ChangeArgs) {
  const action = parseAction(args);
  const got = await client.models.MenuItem.get({ id: args.itemId });
  firstError(got, 'Finding the item');
  const item = got.data;
  if (!item) throw new Refused('That item is not on the menu any more.');
  if (!canEditItem(actor.groups, item.restaurantId)) throw new Refused('Only managers and kitchen at this restaurant can change the board.');

  const by = await displayNameOf(actor.username);
  const now = new Date().toISOString();
  const state: ItemState = {
    id: item.id,
    restaurantId: item.restaurantId,
    name: item.name,
    status: item.status === 'out' ? 'out' : item.status === 'low' ? 'low' : 'available',
    outSince: item.outSince,
    note: item.note,
    markedBy: item.markedBy,
    lowCount: item.lowCount,
    lowSince: item.lowSince,
    openEventId: item.openEventId,
  };
  const p = plan(state, action, by, now);
  if (p.kind === 'noop') return { ok: true, changed: false, reason: p.reason, item };

  // End the open history entry first, so a failure leaves nothing half done
  // that the next tap cannot repair.
  if (p.closeNeeded) {
    const openId = p.closeEventId ?? (await findOpenEvent(item.restaurantId, item.id));
    if (openId) await closeEvent(openId, now, by);
  }

  const update = { ...p.update };
  if (p.openEvent) {
    const ev = await client.models.EightySixEvent.create({
      restaurantId: item.restaurantId,
      itemId: item.id,
      itemName: item.name,
      startedAt: now,
      note: update.note,
      markedBy: by,
      editors: editorGroupsFor(item.restaurantId),
      readers: readersFor(item.restaurantId),
    });
    firstError(ev, 'Writing the history entry');
    update.openEventId = ev.data?.id ?? null;
  }
  const saved = await client.models.MenuItem.update({ id: item.id, ...update, readers: item.readers ?? readersFor(item.restaurantId) });
  firstError(saved, 'Saving the item');
  return { ok: true, changed: true, item: saved.data };
}

// ---------- vendor notes ----------

interface VendorArgs {
  restaurantId: string;
  name: string;
  email: string;
}

// Saves a supplier's email for one restaurant. Owner anywhere, a manager at
// their own restaurant. Saving again corrects it.
async function saveVendor(actor: Actor, args: VendorArgs) {
  const restaurantId = (args.restaurantId ?? '').trim();
  const name = (args.name ?? '').trim().slice(0, 80);
  const email = (args.email ?? '').trim().toLowerCase().slice(0, 120);
  if (!restaurantId || !name) throw new Refused('Which restaurant and which vendor?');
  if (!canSendVendorNote(actor.groups, restaurantId)) throw new Refused('Only a manager at this restaurant can change vendor contacts.');
  if (!looksLikeEmail(email)) throw new Refused('That does not look like an email address. Check it and try again.');
  const id = vendorIdFor(restaurantId, name);
  const by = await displayNameOf(actor.username);
  const got = await client.models.Vendor.get({ id });
  firstError(got, 'Reading the vendor');
  const fields = { restaurantId, name, email, updatedBy: by, readers: vendorReadersFor(restaurantId) };
  const saved = got.data ? await client.models.Vendor.update({ id, ...fields }) : await client.models.Vendor.create({ id, ...fields });
  firstError(saved, 'Saving the vendor');
  return { ok: true, vendor: saved.data };
}

// The manager opened the note in their own email. The item remembers who and
// when until it changes again, so nobody emails the same vendor twice.
async function logVendorNote(actor: Actor, args: { itemId: string }) {
  const got = await client.models.MenuItem.get({ id: args.itemId });
  firstError(got, 'Finding the item');
  const item = got.data;
  if (!item) throw new Refused('That item is not on the menu any more.');
  if (!canSendVendorNote(actor.groups, item.restaurantId)) throw new Refused('Only a manager at this restaurant can send vendor notes.');
  if (item.status !== 'out') throw new Refused(`${item.name} is back on, so there is nothing to tell the vendor.`);
  const by = await displayNameOf(actor.username);
  const saved = await client.models.MenuItem.update({ id: item.id, vendorNoteAt: new Date().toISOString(), vendorNoteBy: by });
  firstError(saved, 'Saving the note');
  return { ok: true, item: saved.data };
}

// ---------- repairData ----------

async function allItems() {
  const out: Schema['MenuItem']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await client.models.MenuItem.list({ limit: 500, nextToken: nextToken ?? undefined });
    firstError(res, 'Listing items');
    out.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

async function allEvents() {
  const out: Schema['EightySixEvent']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await client.models.EightySixEvent.list({ limit: 500, nextToken: nextToken ?? undefined });
    firstError(res, 'Listing history');
    out.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

async function allStaff() {
  const out: Schema['Staff']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await client.models.Staff.list({ limit: 500, nextToken: nextToken ?? undefined });
    firstError(res, 'Listing staff');
    out.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return out;
}

const sameList = (a: (string | null)[] | null | undefined, b: string[]) => !!a && a.length === b.length && b.every((x) => a.includes(x));

async function repairData(actor: Actor, args: { confirm: string }) {
  if (!actor.groups.includes('owner')) throw new Refused('Owner only.');
  if (args.confirm !== 'REPAIR') throw new Refused('Type REPAIR to confirm.');
  const counts = { items: 0, events: 0, staff: 0, openEvents: 0 };

  for (const it of await allItems()) {
    const readers = readersFor(it.restaurantId);
    const patch: Record<string, unknown> = {};
    if (!sameList(it.readers, readers)) patch.readers = readers;
    if (it.status === 'out' && !it.openEventId) {
      const openId = await findOpenEvent(it.restaurantId, it.id);
      if (openId) {
        patch.openEventId = openId;
        counts.openEvents += 1;
      }
    }
    if (Object.keys(patch).length) {
      firstError(await client.models.MenuItem.update({ id: it.id, ...patch }), `Repairing ${it.name}`);
      counts.items += 1;
    }
  }

  for (const ev of await allEvents()) {
    const readers = readersFor(ev.restaurantId);
    if (!sameList(ev.readers, readers)) {
      firstError(await client.models.EightySixEvent.update({ id: ev.id, readers }), `Repairing history for ${ev.itemName}`);
      counts.events += 1;
    }
  }

  for (const p of await allStaff()) {
    const readers = readersFor(p.restaurantId);
    if (!sameList(p.readers, readers)) {
      firstError(await client.models.Staff.update({ id: p.id, readers }), `Repairing staff ${p.username}`);
      counts.staff += 1;
    }
  }

  return { ok: true, ...counts };
}

// ---------- syncMenu ----------

// The board's table for shared/menu.ts. The board is read a moment before it
// is changed, and that read can be a beat behind, so "already gone" and
// "already there" are answers here, not failures.
function menuDb(restaurantId: string, now: string, by: string): MenuDb {
  return {
    async create(row) {
      const made = await client.models.MenuItem.create({
        id: row.id,
        restaurantId,
        name: row.name,
        category: row.category,
        sortOrder: row.sortOrder,
        status: 'available',
        editors: editorGroupsFor(restaurantId),
        readers: readersFor(restaurantId),
      });
      if (conditionFailed(made.errors)) return false;
      firstError(made, `Adding ${row.name}`);
      return true;
    },
    async update(row) {
      const changed = await client.models.MenuItem.update({ id: row.id, name: row.name, category: row.category, sortOrder: row.sortOrder });
      if (conditionFailed(changed.errors)) return false;
      firstError(changed, `Updating ${row.name}`);
      return true;
    },
    async remove(row) {
      // An 86'd item leaves the board: close its history entry first, so no
      // entry stays open for good.
      if (row.status === 'out') {
        const openId = row.openEventId ?? (await findOpenEvent(restaurantId, row.id));
        if (openId) await closeEvent(openId, now, by);
      }
      const gone = await client.models.MenuItem.delete({ id: row.id });
      if (!conditionFailed(gone.errors)) firstError(gone, `Removing ${row.name}`);
    },
  };
}

// Owner only. Makes one restaurant's board menu match the lists loaded for
// Ask there (shared/menu.ts works out what has to change, and in which
// order). An item that stays keeps its state; an item that is gone leaves
// the board. Safe to run again, and safe to run twice at once: it starts
// from what the board holds at that moment.
async function syncMenu(actor: Actor, args: { restaurantId: string }) {
  if (!actor.groups.includes('owner')) throw new Refused('Owner only.');
  const restaurantId = (args.restaurantId ?? '').trim();
  const stored = restaurantId ? await client.models.AskLists.get({ id: restaurantId }) : null;
  if (stored) firstError(stored, 'Reading the lists');
  if (!stored?.data) throw new Refused('Load lists for this restaurant first. The board menu comes from them.');
  let wanted;
  try {
    wanted = menuFromLists(JSON.parse(stored.data.body) as Pick<AssistantCatalog, 'items'>);
  } catch {
    throw new Refused('The stored lists cannot be read. Load them again.');
  }

  const existing: BoardRow[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await client.models.MenuItem.listMenuItemByRestaurantId({ restaurantId }, { limit: 500, nextToken: nextToken ?? undefined });
    firstError(res, 'Reading the board');
    for (const i of res.data) existing.push({ id: i.id, name: i.name, category: i.category, sortOrder: i.sortOrder, status: i.status, openEventId: i.openEventId });
    nextToken = res.nextToken;
  } while (nextToken);

  const plan = planMenu(restaurantId, existing, wanted);
  await applyMenu(menuDb(restaurantId, new Date().toISOString(), await displayNameOf(actor.username)), plan);
  return { ok: true, total: wanted.length, created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}

// ---------- entry ----------

type AppEvent = AppSyncResolverEvent<Partial<ChangeArgs & VendorArgs & { confirm: string }>>;
type Operation = 'changeItem' | 'repairData' | 'saveVendor' | 'logVendorNote' | 'syncMenu';
const OPERATIONS: Operation[] = ['changeItem', 'repairData', 'saveVendor', 'logVendorNote', 'syncMenu'];

function operationOf(event: AppEvent): Operation {
  const named = (event as { info?: { fieldName?: string } }).info?.fieldName as Operation | undefined;
  if (named && OPERATIONS.includes(named)) return named;
  const args = event.arguments ?? {};
  if (typeof args.confirm === 'string') return 'repairData';
  if (typeof args.email === 'string') return 'saveVendor';
  if (typeof args.restaurantId === 'string') return 'syncMenu';
  if (typeof args.itemId === 'string' && typeof args.action !== 'string') return 'logVendorNote';
  return 'changeItem';
}

export const handler = async (event: AppEvent) => {
  const actor = actorFrom(event);
  try {
    switch (operationOf(event)) {
      case 'changeItem':
        return await changeItem(actor, event.arguments as ChangeArgs);
      case 'repairData':
        return await repairData(actor, event.arguments as { confirm: string });
      case 'saveVendor':
        return await saveVendor(actor, event.arguments as VendorArgs);
      case 'logVendorNote':
        return await logVendorNote(actor, event.arguments as { itemId: string });
      case 'syncMenu':
        return await syncMenu(actor, event.arguments as { restaurantId: string });
    }
  } catch (e) {
    if (e instanceof Refused) throw e;
    console.error(e);
    throw new Error(e instanceof Error ? e.message : 'Something went wrong.');
  }
};
