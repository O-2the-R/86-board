// The real thing: Cognito for logins, the shared database for the board.
// Fills the same data drawer as the sample mode, so no screen knows the difference.
import { generateClient } from 'aws-amplify/data';
import { confirmSignIn, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import { editorGroupsFor } from '../../shared/sample-data';
import type { BoardApi, ManageStaffInput, ManageStaffResult, SeedResult, SignInResult } from './types';
import type { EightySixEvent, MenuItem, Restaurant, Role, Session, Staff } from '../types';

type Client = ReturnType<typeof generateClient<Schema>>;
let cached: Client | null = null;
const client = (): Client => (cached ??= generateClient<Schema>());

const HOUR = 3_600_000;
const orUndef = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

function check<T>(res: { data: T; errors?: { message: string }[] | undefined }, what: string): T {
  if (res.errors?.length) throw new Error(`${what}: ${res.errors.map((e) => e.message).join('; ')}`);
  return res.data;
}

// "main-kitchen" -> kitchen at main. "owner" -> owner of all.
export function parseGroups(groups: string[]): { role: Role; restaurantId: string } {
  if (groups.includes('owner')) return { role: 'owner', restaurantId: 'all' };
  for (const g of groups) {
    const m = /^(.+)-(manager|kitchen|server|host)$/.exec(g);
    if (m) return { role: m[2] as Role, restaurantId: m[1] };
  }
  return { role: 'host', restaurantId: '' };
}

async function sessionFromTokens(): Promise<Session | null> {
  const s = await fetchAuthSession();
  const access = s.tokens?.accessToken;
  if (!access) return null;
  const groups = (access.payload['cognito:groups'] as string[] | undefined) ?? [];
  const username = (access.payload.username as string | undefined) ?? (await getCurrentUser()).username;
  const displayName = (s.tokens?.idToken?.payload.name as string | undefined) ?? username;
  return { username, displayName, ...parseGroups(groups) };
}

const toItem = (i: Schema['MenuItem']['type']): MenuItem => ({
  id: i.id,
  restaurantId: i.restaurantId,
  name: i.name,
  category: i.category,
  vendor: orUndef(i.vendor),
  sortOrder: orUndef(i.sortOrder),
  status: i.status === 'out' ? 'out' : 'available',
  outSince: orUndef(i.outSince),
  note: orUndef(i.note),
  markedBy: orUndef(i.markedBy),
});

const toEvent = (e: Schema['EightySixEvent']['type']): EightySixEvent => ({
  id: e.id,
  itemId: e.itemId,
  itemName: e.itemName,
  restaurantId: e.restaurantId,
  startedAt: e.startedAt,
  endedAt: orUndef(e.endedAt),
  note: orUndef(e.note),
  markedBy: e.markedBy,
  clearedBy: orUndef(e.clearedBy),
});

const toStaff = (p: Schema['Staff']['type']): Staff => ({
  username: p.username,
  displayName: p.displayName,
  role: p.role as Role,
  restaurantId: p.restaurantId,
  active: p.active,
});

const parseJson = <T>(v: unknown): T => (typeof v === 'string' ? (JSON.parse(v) as T) : (v as T));

export const awsApi: BoardApi = {
  mode: 'aws',

  async currentSession() {
    try {
      return await sessionFromTokens();
    } catch {
      return null;
    }
  },

  async signIn(username, password): Promise<SignInResult> {
    const res = await signIn({ username: username.trim().toLowerCase(), password });
    const step = res.nextStep.signInStep;
    if (step === 'DONE') return { status: 'done' };
    if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') return { status: 'newPassword' };
    throw new Error(`Sign-in needs a step this app does not handle yet (${step}).`);
  },

  async completeNewPassword(password) {
    const res = await confirmSignIn({ challengeResponse: password });
    if (res.nextStep.signInStep !== 'DONE') throw new Error('Could not finish setting the new password.');
  },

  async signOut() {
    await signOut();
  },

  async accessStillValid(username) {
    const res = await client().models.Staff.get({ id: username });
    if (res.errors?.length) return true; // a hiccup is not a lockout
    return res.data ? res.data.active !== false : true;
  },

  async listRestaurants() {
    const rows = check(await client().models.Restaurant.list({ limit: 50 }), 'Loading restaurants');
    return rows
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((r): Restaurant => ({ id: r.id, name: r.name, kind: r.kind }));
  },

  async listItems(restaurantId) {
    const rows = check(await client().models.MenuItem.listMenuItemByRestaurantId({ restaurantId }, { limit: 500 }), 'Loading the board');
    return rows.map(toItem).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },

  async markOut(itemId, note, by) {
    const item = check(await client().models.MenuItem.get({ id: itemId }), 'Finding the item');
    if (!item || item.status === 'out') return;
    const now = new Date().toISOString();
    check(await client().models.MenuItem.update({ id: itemId, status: 'out', outSince: now, note: note || null, markedBy: by }), 'Marking the item 86’d');
    check(
      await client().models.EightySixEvent.create({
        restaurantId: item.restaurantId,
        itemId: item.id,
        itemName: item.name,
        startedAt: now,
        note: note || null,
        markedBy: by,
        editors: editorGroupsFor(item.restaurantId),
      }),
      'Writing the history entry',
    );
  },

  async markBack(itemId, by) {
    const item = check(await client().models.MenuItem.get({ id: itemId }), 'Finding the item');
    if (!item || item.status !== 'out') return;
    const now = new Date().toISOString();
    check(await client().models.MenuItem.update({ id: itemId, status: 'available', outSince: null, note: null, markedBy: null }), 'Marking the item back on');
    const open = check(
      await client().models.EightySixEvent.listEightySixEventByRestaurantIdAndStartedAt(
        { restaurantId: item.restaurantId },
        { sortDirection: 'DESC', limit: 100, filter: { itemId: { eq: itemId }, endedAt: { attributeExists: false } } },
      ),
      'Finding the open history entry',
    );
    await Promise.all(open.map((e) => client().models.EightySixEvent.update({ id: e.id, endedAt: now, clearedBy: by })));
  },

  async listHistory(restaurantId, days) {
    const rows = check(
      await client().models.EightySixEvent.listEightySixEventByRestaurantIdAndStartedAt({ restaurantId }, { sortDirection: 'DESC', limit: 500 }),
      'Loading history',
    );
    const cutoff = Date.now() - days * 24 * HOUR;
    const now = Date.now();
    return rows.map(toEvent).filter((e) => (e.endedAt ? Date.parse(e.endedAt) : now) >= cutoff);
  },

  async listStaff() {
    const rows = check(await client().models.Staff.list({ limit: 1000 }), 'Loading staff');
    return rows.map(toStaff);
  },

  async manageStaff(input: ManageStaffInput): Promise<ManageStaffResult> {
    const res = await client().mutations.manageStaff({
      action: input.action,
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      restaurantId: input.restaurantId,
    });
    return parseJson<ManageStaffResult>(check(res, 'Updating staff'));
  },

  async seedDemo(): Promise<SeedResult> {
    const res = await client().mutations.seedDemo({ confirm: 'LOAD' });
    return parseJson<SeedResult>(check(res, 'Loading demo data'));
  },
};
