// The real thing: Cognito for logins, the shared database for the board.
// Fills the same data drawer as the sample mode, so no screen knows the difference.
import { generateClient } from 'aws-amplify/data';
import { confirmSignIn, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import type { BoardApi, IntegrationSettings, ManageStaffInput, ManageStaffResult, PushSubscriptionInput, RepairResult, SeedResult, SignInResult } from './types';
import { REPORT_URL } from '../amplify';
import { newKey } from '../lib/random';
import type { EightySixEvent, ItemStatus, MenuItem, Restaurant, Role, Session, Staff } from '../types';

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

const toStatus = (s: string): ItemStatus => (s === 'out' ? 'out' : s === 'low' ? 'low' : 'available');

const toItem = (i: Schema['MenuItem']['type']): MenuItem => ({
  id: i.id,
  restaurantId: i.restaurantId,
  name: i.name,
  category: i.category,
  vendor: orUndef(i.vendor),
  sortOrder: orUndef(i.sortOrder),
  status: toStatus(i.status),
  outSince: orUndef(i.outSince),
  note: orUndef(i.note),
  markedBy: orUndef(i.markedBy),
  lowCount: orUndef(i.lowCount),
  lowSince: orUndef(i.lowSince),
});

// Follows the pages of a list until there are none, so a long menu, a busy
// month or a big staff never gets cut off at the first page.
async function allPages<T>(
  what: string,
  page: (nextToken: string | undefined) => Promise<{ data: T[]; nextToken?: string | null; errors?: { message: string }[] }>,
  stop?: (rows: T[]) => boolean,
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | undefined;
  for (let i = 0; i < 100; i++) {
    const res = await page(nextToken);
    check(res, what);
    out.push(...res.data);
    if (!res.nextToken || (stop && stop(res.data))) break;
    nextToken = res.nextToken;
  }
  return out;
}

// Every change to the board goes through the board function, which checks
// the caller's role and stamps their name. The `by` the screens pass along
// is only used by the sample mode.
async function change(itemId: string, action: 'out' | 'low' | 'back', extra: { note?: string; count?: number } = {}) {
  const res = await client().mutations.changeItem({ itemId, action, note: extra.note, count: extra.count });
  check(res, action === 'out' ? 'Marking the item 86’d' : action === 'low' ? 'Marking the item running low' : 'Marking the item back on');
}

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
    const rows = await allPages('Loading restaurants', (nextToken) => client().models.Restaurant.list({ limit: 50, nextToken }));
    return rows
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((r): Restaurant => ({ id: r.id, name: r.name, kind: r.kind }));
  },

  async listItems(restaurantId) {
    const rows = await allPages('Loading the board', (nextToken) => client().models.MenuItem.listMenuItemByRestaurantId({ restaurantId }, { limit: 500, nextToken }));
    return rows.map(toItem).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  },

  async markOut(itemId, note) {
    await change(itemId, 'out', { note });
  },

  async markLow(itemId, count) {
    await change(itemId, 'low', { count });
  },

  async markBack(itemId) {
    await change(itemId, 'back');
  },

  async listHistory(restaurantId, days) {
    const cutoff = Date.now() - days * 24 * HOUR;
    const cutoffIso = new Date(cutoff).toISOString();
    // Newest first; stop paging once a whole page started before the cutoff.
    const rows = await allPages(
      'Loading history',
      (nextToken) => client().models.EightySixEvent.listEightySixEventByRestaurantIdAndStartedAt({ restaurantId }, { sortDirection: 'DESC', limit: 200, nextToken }),
      (page) => page.length > 0 && page.every((e) => e.startedAt < cutoffIso),
    );
    const now = Date.now();
    return rows.map(toEvent).filter((e) => (e.endedAt ? Date.parse(e.endedAt) : now) >= cutoff);
  },

  async listStaff() {
    const rows = await allPages('Loading staff', (nextToken) => client().models.Staff.list({ limit: 500, nextToken }));
    return rows.map(toStaff);
  },

  async manageStaff(input: ManageStaffInput): Promise<ManageStaffResult> {
    const res = await client().mutations.manageStaff({
      action: input.action,
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      restaurantId: input.restaurantId,
      password: input.password || undefined,
    });
    return parseJson<ManageStaffResult>(check(res, 'Updating staff'));
  },

  async seedDemo(): Promise<SeedResult> {
    const res = await client().mutations.seedDemo({ confirm: 'LOAD' });
    return parseJson<SeedResult>(check(res, 'Loading demo data'));
  },

  async repairData(): Promise<RepairResult> {
    const res = await client().mutations.repairData({ confirm: 'REPAIR' });
    return parseJson<RepairResult>(check(res, 'Repairing the data'));
  },

  async pushPublicKey() {
    const res = await client().queries.pushPublicKey();
    return check(res, 'Getting the alert key') ?? null;
  },

  async subscribePush(sub: PushSubscriptionInput) {
    check(await client().mutations.subscribePush(sub), 'Turning alerts on');
  },

  async unsubscribePush(endpoint: string) {
    check(await client().mutations.unsubscribePush({ endpoint }), 'Turning alerts off');
  },

  async getIntegration(): Promise<IntegrationSettings> {
    const got = check(await client().models.Integration.get({ id: INTEGRATION_ID }), 'Reading the automation settings');
    if (got) return toIntegration(got);
    // First visit: make the key now so it can be pasted into n8n before anything else is saved.
    const made = check(await client().models.Integration.create({ id: INTEGRATION_ID, key: newKey() }), 'Creating the automation settings');
    if (!made) throw new Error('Could not create the automation settings.');
    return toIntegration(made);
  },

  async saveIntegration(webhookUrl: string, key: string): Promise<IntegrationSettings> {
    const saved = check(await client().models.Integration.update({ id: INTEGRATION_ID, webhookUrl: webhookUrl.trim() || null, key }), 'Saving the automation settings');
    if (!saved) throw new Error('Could not save the automation settings.');
    return toIntegration(saved);
  },

  async testWebhook() {
    const res = await client().mutations.testWebhook({ test: 'now' });
    return parseJson<{ ok: boolean; summary: string }>(check(res, 'Sending the test'));
  },
};

const INTEGRATION_ID = 'n8n';

const toIntegration = (r: Schema['Integration']['type']): IntegrationSettings => ({
  webhookUrl: r.webhookUrl ?? '',
  key: r.key,
  reportUrl: REPORT_URL,
  lastTestAt: orUndef(r.lastTestAt),
  lastTestResult: orUndef(r.lastTestResult),
});
