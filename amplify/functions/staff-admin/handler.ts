// Runs behind the manageStaff and seedDemo mutations. It is the only code
// that talks to the Cognito user pool, so the rules about who may create or
// switch off whom live in one place.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import { env } from '$amplify/env/staff-admin';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Schema } from '../../data/resource';
import {
  CLOSED_SEEDS,
  MENUS,
  OPEN_SEEDS,
  RESTAURANTS,
  STAFF,
  editorGroupsFor,
  groupFor,
  itemIdFor,
  type SeedRole,
} from '../../../shared/sample-data';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const client = generateClient<Schema>();
const cognito = new CognitoIdentityProviderClient();
// Set in backend.ts alongside the Cognito permissions.
const USER_POOL_ID = process.env.USER_POOL_ID ?? '';

const ROLES: SeedRole[] = ['manager', 'kitchen', 'server', 'host'];
const RESTAURANT_IDS = RESTAURANTS.map((r) => r.id);
const DEMO_PASSWORD = 'Welcome86!'; // every sample staff account; the owner's is set separately
const HOUR = 3_600_000;

interface ManageArgs {
  action: string;
  username: string;
  displayName?: string | null;
  role?: string | null;
  restaurantId?: string | null;
}
interface SeedArgs {
  confirm: string;
}

interface Actor {
  username: string;
  groups: string[];
  isOwner: boolean;
  managerOf: string[]; // restaurant ids this person manages
}

class Refused extends Error {}

function actorFrom(event: AppSyncResolverEvent<unknown>): Actor {
  const id = event.identity as AppSyncIdentityCognito | null;
  if (!id || !('username' in id)) throw new Refused('Sign in first.');
  const groups = id.groups ?? [];
  return {
    username: id.username,
    groups,
    isOwner: groups.includes('owner'),
    managerOf: RESTAURANT_IDS.filter((r) => groups.includes(groupFor(r, 'manager'))),
  };
}

const tempPassword = () => `Board-${1000 + Math.floor(Math.random() * 9000)}!`;

const cleanUsername = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

function firstError(res: { errors?: { message: string }[] | undefined }, what: string) {
  if (res.errors?.length) throw new Error(`${what}: ${res.errors.map((e) => e.message).join('; ')}`);
}

// ---------- Cognito helpers ----------

async function userExists(username: string): Promise<boolean> {
  try {
    await cognito.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    return true;
  } catch (e) {
    if (e instanceof UserNotFoundException) return false;
    throw e;
  }
}

async function createLogin(username: string, displayName: string, group: string, password: string, permanent: boolean) {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: username,
        TemporaryPassword: password,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'name', Value: displayName }],
      }),
    );
  } catch (e) {
    if (!(e instanceof UsernameExistsException)) throw e;
  }
  if (permanent) {
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: username, Password: password, Permanent: true }));
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: USER_POOL_ID, Username: username, GroupName: group }));
}

// ---------- manageStaff ----------

async function manageStaff(actor: Actor, args: ManageArgs) {
  const username = cleanUsername(args.username);
  if (!username) throw new Refused('Username is required.');
  const by = actor.username;

  if (args.action === 'create') {
    const displayName = (args.displayName ?? '').trim();
    const role = (args.role ?? '') as SeedRole;
    const restaurantId = args.restaurantId ?? '';
    if (!displayName) throw new Refused('Name is required.');
    if (!ROLES.includes(role)) throw new Refused('Role must be manager, kitchen, server or host.');
    if (!RESTAURANT_IDS.includes(restaurantId)) throw new Refused('Pick a restaurant.');
    if (!actor.isOwner && !actor.managerOf.includes(restaurantId)) throw new Refused('You can only add staff at your own restaurant.');
    if (await userExists(username)) throw new Refused(`The username ${username} is already taken.`);

    const password = tempPassword();
    await createLogin(username, displayName, groupFor(restaurantId, role), password, false);
    const res = await client.models.Staff.create({ id: username, username, displayName, role, restaurantId, active: true, lastChangedBy: by });
    firstError(res, 'Saving the staff record');
    return { ok: true, username, temporaryPassword: password };
  }

  // Everything below acts on an existing person.
  const existing = await client.models.Staff.get({ id: username });
  firstError(existing, 'Looking up the staff record');
  const person = existing.data;
  if (!person) throw new Refused(`No staff record for ${username}.`);
  if (person.role === 'owner' && !actor.isOwner) throw new Refused('Only the owner can change the owner account.');
  if (!actor.isOwner && !actor.managerOf.includes(person.restaurantId)) throw new Refused('You can only manage staff at your own restaurant.');

  if (args.action === 'deactivate') {
    if (username === actor.username) throw new Refused('You cannot switch off your own account.');
    await cognito.send(new AdminDisableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    try {
      await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    } catch {
      // never signed in; nothing to sign out
    }
    const res = await client.models.Staff.update({ id: username, active: false, lastChangedBy: by });
    firstError(res, 'Saving the staff record');
    return { ok: true, username, active: false };
  }

  if (args.action === 'reactivate') {
    await cognito.send(new AdminEnableUserCommand({ UserPoolId: USER_POOL_ID, Username: username }));
    const res = await client.models.Staff.update({ id: username, active: true, lastChangedBy: by });
    firstError(res, 'Saving the staff record');
    return { ok: true, username, active: true };
  }

  if (args.action === 'resetPassword') {
    const password = tempPassword();
    await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: USER_POOL_ID, Username: username, Password: password, Permanent: false }));
    const res = await client.models.Staff.update({ id: username, lastChangedBy: by });
    firstError(res, 'Saving the staff record');
    return { ok: true, username, temporaryPassword: password };
  }

  throw new Refused(`Unknown action ${args.action}.`);
}

// ---------- seedDemo ----------

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function seedDemo(actor: Actor, args: SeedArgs) {
  if (!actor.isOwner) throw new Refused('Owner only.');
  if (args.confirm !== 'LOAD') throw new Refused('Type LOAD to confirm.');
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * HOUR).toISOString();
  const counts = { restaurants: 0, items: 0, events: 0, staff: 0 };

  // Restaurants
  for (const [i, r] of RESTAURANTS.entries()) {
    const got = await client.models.Restaurant.get({ id: r.id });
    if (got.data) continue;
    const res = await client.models.Restaurant.create({ id: r.id, name: r.name, kind: r.kind, sortOrder: i });
    firstError(res, `Creating ${r.name}`);
    counts.restaurants += 1;
  }

  // Menu items
  const existingItems = await client.models.MenuItem.list({ limit: 1000 });
  firstError(existingItems, 'Listing items');
  const have = new Set(existingItems.data.map((i) => i.id));
  const rows = RESTAURANTS.flatMap((r) =>
    MENUS[r.id].map(([category, name, vendor], idx) => ({ restaurantId: r.id, category, name, vendor, sortOrder: idx })),
  );
  await inBatches(rows, 8, async (row) => {
    const id = itemIdFor(row.restaurantId, row.name);
    if (have.has(id)) return;
    const res = await client.models.MenuItem.create({
      id,
      restaurantId: row.restaurantId,
      name: row.name,
      category: row.category,
      vendor: row.vendor,
      sortOrder: row.sortOrder,
      status: 'available',
      editors: editorGroupsFor(row.restaurantId),
    });
    firstError(res, `Creating ${row.name}`);
    counts.items += 1;
  });

  // History, only when the log is empty
  const anyEvent = await client.models.EightySixEvent.list({ limit: 1 });
  firstError(anyEvent, 'Checking history');
  if (anyEvent.data.length === 0) {
    await inBatches(CLOSED_SEEDS, 8, async (s) => {
      const res = await client.models.EightySixEvent.create({
        restaurantId: s.rest,
        itemId: itemIdFor(s.rest, s.item),
        itemName: s.item,
        startedAt: ago(s.hoursAgo),
        endedAt: ago(s.hoursAgo - s.hours),
        note: s.note,
        markedBy: s.by,
        clearedBy: s.clearedBy,
        editors: editorGroupsFor(s.rest),
      });
      firstError(res, `History for ${s.item}`);
      counts.events += 1;
    });
    await inBatches(OPEN_SEEDS, 8, async (s) => {
      const startedAt = ago(s.hoursAgo);
      const id = itemIdFor(s.rest, s.item);
      const ev = await client.models.EightySixEvent.create({
        restaurantId: s.rest,
        itemId: id,
        itemName: s.item,
        startedAt,
        note: s.note,
        markedBy: s.by,
        editors: editorGroupsFor(s.rest),
      });
      firstError(ev, `Open 86 for ${s.item}`);
      const up = await client.models.MenuItem.update({ id, status: 'out', outSince: startedAt, note: s.note, markedBy: s.by });
      firstError(up, `Marking ${s.item} out`);
      counts.events += 1;
    });
  }

  // Staff logins
  await inBatches(STAFF, 6, async (p) => {
    const existed = await userExists(p.username);
    await createLogin(p.username, p.displayName, groupFor(p.restaurantId, p.role), DEMO_PASSWORD, true);
    const rec = await client.models.Staff.get({ id: p.username });
    if (!rec.data) {
      const res = await client.models.Staff.create({
        id: p.username,
        username: p.username,
        displayName: p.displayName,
        role: p.role,
        restaurantId: p.restaurantId,
        active: true,
        lastChangedBy: actor.username,
      });
      firstError(res, `Staff record for ${p.username}`);
    }
    if (!existed) counts.staff += 1;
  });

  // The owner's own record, so the Staff screen shows them too
  const me = await client.models.Staff.get({ id: actor.username });
  if (!me.data) {
    const res = await client.models.Staff.create({
      id: actor.username,
      username: actor.username,
      displayName: 'Omar',
      role: 'owner',
      restaurantId: 'all',
      active: true,
      lastChangedBy: actor.username,
    });
    firstError(res, 'Owner staff record');
  }

  return { ok: true, ...counts, demoPassword: DEMO_PASSWORD };
}

// ---------- entry ----------

export const handler = async (event: AppSyncResolverEvent<ManageArgs | SeedArgs>) => {
  const actor = actorFrom(event);
  try {
    switch (event.info.fieldName) {
      case 'manageStaff':
        return await manageStaff(actor, event.arguments as ManageArgs);
      case 'seedDemo':
        return await seedDemo(actor, event.arguments as SeedArgs);
      default:
        throw new Refused(`Unknown operation ${event.info.fieldName}.`);
    }
  } catch (e) {
    if (e instanceof Refused) throw e;
    console.error(e);
    throw new Error(e instanceof Error ? e.message : 'Something went wrong.');
  }
};
