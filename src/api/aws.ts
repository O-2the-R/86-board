// The real thing: Cognito for logins, the shared database for the board.
// Fills the same data drawer as the sample mode, so no screen knows the difference.
import { CONNECTION_STATE_CHANGE, generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import { confirmSignIn, fetchAuthSession, getCurrentUser, signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../../amplify/data/resource';
import type { AskAiTest, AskResult, AskSetup, BoardApi, IntegrationSettings, LiveHandlers, ManageStaffInput, ManageStaffResult, PushSubscriptionInput, RepairResult, SeedResult, SignInResult } from './types';
import { linkStateOf } from '../lib/live';
import { REPORT_URL } from '../amplify';
import { newKey } from '../lib/random';
import type { EightySixEvent, ItemStatus, MenuItem, Restaurant, Role, Session, Staff, Vendor } from '../types';
import type { AssistantCatalog } from '../../shared/assistant/catalog';

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
  vendorNoteAt: orUndef(i.vendorNoteAt),
  vendorNoteBy: orUndef(i.vendorNoteBy),
  updatedAt: orUndef(i.updatedAt),
});

const toVendor = (v: Pick<Schema['Vendor']['type'], 'id' | 'restaurantId' | 'name' | 'email'>): Vendor => ({ id: v.id, restaurantId: v.restaurantId, name: v.name, email: v.email });

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

  // AppSync subscriptions: the board function saves every change through the
  // same API, so each save is pushed to every phone watching that restaurant.
  // The server only sends a phone the items its groups may read.
  watchItems(restaurantId: string, on: LiveHandlers) {
    const filter = { restaurantId: { eq: restaurantId } };
    const upsert = (i: Schema['MenuItem']['type']) => on.change({ kind: 'upsert', item: toItem(i) });
    const failed = () => on.failed();
    // Listen to the connection first, so its first word is not missed.
    const stopLink = watchConnection((state) => on.link(linkStateOf(state)));
    const m = client().models.MenuItem;
    const subs = [
      m.onCreate({ filter }).subscribe({ next: upsert, error: failed }),
      m.onUpdate({ filter }).subscribe({ next: upsert, error: failed }),
      m.onDelete({ filter }).subscribe({ next: (i) => on.change({ kind: 'remove', id: i.id }), error: failed }),
    ];
    // Switching restaurants reuses a connection that is already up, which
    // announces nothing new; say where it stands now.
    if (lastConnection) on.link(linkStateOf(lastConnection));
    return () => {
      stopLink();
      for (const sub of subs) sub.unsubscribe();
    };
  },

  async listVendors(restaurantId) {
    const rows = await allPages('Loading vendors', (nextToken) => client().models.Vendor.listVendorByRestaurantId({ restaurantId }, { limit: 200, nextToken }));
    return rows.map(toVendor).sort((a, b) => a.name.localeCompare(b.name));
  },

  async saveVendor(restaurantId, name, email) {
    const res = await client().mutations.saveVendor({ restaurantId, name, email });
    const out = parseJson<{ ok: boolean; vendor: Schema['Vendor']['type'] }>(check(res, 'Saving the vendor'));
    return toVendor(out.vendor);
  },

  async logVendorNote(itemId) {
    check(await client().mutations.logVendorNote({ itemId }), 'Recording the vendor note');
  },

  // Ask. The assistant function decides who gets the lists and builds what
  // the AI reads on the server (the stored lists, the board in the database).
  // The phone sends only the chat and the allergies picked for this guest.
  async getAssistant(restaurantId) {
    const res = await client().queries.getAssistant({ restaurantId });
    return parseJson<AssistantCatalog | null>(check(res, 'Loading Ask')) ?? null;
  },

  async askAssistant(restaurantId, input, _now, opts): Promise<AskResult> {
    const stopped = () => new Error('Stopped.');
    if (opts?.signal?.aborted) throw stopped();
    const sent = client().mutations.askAssistant({ restaurantId, turns: JSON.stringify(input.turns), known: input.known });
    // The answer arrives whole. Stop only stops waiting for it.
    const res = await (opts?.signal
      ? Promise.race([sent, new Promise<never>((_, reject) => opts.signal?.addEventListener('abort', () => reject(stopped()), { once: true }))])
      : sent);
    // the function's own sentence, as it is: it is shown in the chat
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(' '));
    const out = parseJson<AskResult | null>(res.data);
    if (!out?.text) throw new Error('The AI could not answer that. Send it again.');
    opts?.onText?.(out.text);
    return { text: out.text, truncated: Boolean(out.truncated) };
  },

  async getAskSetup() {
    return (await manageAsk({ action: 'status' }, 'Loading the Ask setup')).restaurants.map(toAskSetup);
  },

  async loadAskLists(restaurantId, fileText) {
    return oneSetup(await manageAsk({ action: 'load', restaurantId, lists: fileText }, 'Loading the lists'));
  },

  async setAskAudience(restaurantId, staffCanUse) {
    return oneSetup(await manageAsk({ action: 'audience', restaurantId, staffCanUse }, 'Saving who can use Ask'));
  },

  async removeAskLists(restaurantId) {
    return oneSetup(await manageAsk({ action: 'remove', restaurantId }, 'Removing the lists'));
  },

  async testAskAi(): Promise<AskAiTest> {
    const res = await client().mutations.manageAssistant({ action: 'test' });
    const out = parseJson<AskAiTest>(check(res, 'Testing the AI'));
    return { ok: Boolean(out.ok), problem: out.problem, summary: out.summary, detail: out.detail, model: out.model };
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

// ----- Ask setup (owner) -----
type AskSetupRow = { [K in keyof AskSetup]: AskSetup[K] | null };

async function manageAsk(args: { action: string; restaurantId?: string; lists?: string; staffCanUse?: boolean }, what: string): Promise<{ restaurants: AskSetupRow[] }> {
  const res = await client().mutations.manageAssistant(args);
  // a refusal is the function's own sentence ("Crispy Calamari: ..."): show it as it is
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(' '));
  const out = parseJson<{ restaurants?: AskSetupRow[] } | null>(res.data);
  if (!out?.restaurants) throw new Error(`${what} did not finish. Try again.`);
  return { restaurants: out.restaurants };
}

function oneSetup(out: { restaurants: AskSetupRow[] }): AskSetup {
  const first = out.restaurants[0];
  if (!first) throw new Error('That did not finish. Try again.');
  return toAskSetup(first);
}

const toAskSetup = (r: AskSetupRow): AskSetup => ({
  restaurantId: r.restaurantId ?? '',
  loaded: Boolean(r.loaded),
  sample: Boolean(r.sample),
  staffCanUse: Boolean(r.staffCanUse),
  name: orUndef(r.name),
  asOf: orUndef(r.asOf),
  items: r.items ?? 0,
  notes: r.notes ?? 0,
  loadedAt: orUndef(r.loadedAt),
  loadedBy: orUndef(r.loadedBy),
  questionsToday: r.questionsToday ?? 0,
  questions30: r.questions30 ?? 0,
  dailyLimit: r.dailyLimit ?? 0,
});

// Amplify announces the live connection's state on its Hub, one connection
// for all subscriptions. One listener remembers the latest state and passes
// it on to whichever board is watching.
let lastConnection: string | undefined;
let hubStarted = false;
const connectionListeners = new Set<(state: string) => void>();

function watchConnection(fn: (state: string) => void): () => void {
  if (!hubStarted) {
    hubStarted = true;
    Hub.listen('api', ({ payload }) => {
      if (payload.event !== CONNECTION_STATE_CHANGE) return;
      const state = (payload.data as { connectionState?: string } | undefined)?.connectionState;
      if (!state) return;
      lastConnection = state;
      for (const l of connectionListeners) l(state);
    });
  }
  connectionListeners.add(fn);
  return () => {
    connectionListeners.delete(fn);
  };
}

const toIntegration = (r: Schema['Integration']['type']): IntegrationSettings => ({
  webhookUrl: r.webhookUrl ?? '',
  key: r.key,
  reportUrl: REPORT_URL,
  lastTestAt: orUndef(r.lastTestAt),
  lastTestResult: orUndef(r.lastTestResult),
});
