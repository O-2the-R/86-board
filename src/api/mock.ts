// Sample mode. Everything lives in this browser's storage, so the app can be
// tried anywhere without a backend. Sign in as any sample person (omar,
// priya.m, marco.r, sam.t, lena.k ...) with any password. The public demo
// runs on this too: its made-up guest logins (guest.kitchen.4821) are the one
// exception, and need the password the demo showed.
import type { BoardApi, IntegrationSettings, ManageStaffInput, ManageStaffResult, SeedResult, SignInResult } from './types';
import { newKey, randomInt } from '../lib/random';
import type { EightySixEvent, MenuItem, Restaurant, Session, Staff } from '../types';
import { readJSON, removeKey, writeJSON } from '../lib/storage';
import { CLOSED_SEEDS, LOW_SEEDS, MENUS, OPEN_SEEDS, RESTAURANTS, STAFF, itemIdFor } from '../../shared/sample-data';
import { cleanUsername, nextFreeUsername, passwordFrom } from '../../shared/logins';
import { isGuestUsername } from '../lib/demo';

export const SAMPLE_KEY = 'eightysix.sample.v3';
const SESSION_KEY = 'eightysix.sample.session';
const GUESTS_KEY = 'eightysix.sample.guests'; // demo username -> its password
const MAX_GUESTS = 5; // demo logins kept on this phone

interface Store {
  restaurants: Restaurant[];
  items: MenuItem[];
  events: EightySixEvent[];
  staff: Staff[];
}

const HOUR = 3_600_000;
const uid = () => Math.random().toString(36).slice(2, 10);
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const wait = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const OWNER: Staff = { username: 'omar', displayName: 'Omar', role: 'owner', restaurantId: 'all', active: true };

function seed(): Store {
  const items: MenuItem[] = [];
  for (const r of RESTAURANTS) {
    MENUS[r.id].forEach(([category, name, vendor], sortOrder) => {
      items.push({ id: itemIdFor(r.id, name), restaurantId: r.id, name, category, vendor, sortOrder, status: 'available' });
    });
  }
  const find = (rest: string, name: string) => items.find((i) => i.restaurantId === rest && i.name === name);
  const events: EightySixEvent[] = [];

  for (const s of CLOSED_SEEDS) {
    const it = find(s.rest, s.item);
    if (!it) continue;
    events.push({
      id: uid(),
      itemId: it.id,
      itemName: it.name,
      restaurantId: it.restaurantId,
      startedAt: ago(s.hoursAgo),
      endedAt: ago(s.hoursAgo - s.hours),
      note: s.note,
      markedBy: s.by,
      clearedBy: s.clearedBy,
    });
  }
  for (const s of OPEN_SEEDS) {
    const it = find(s.rest, s.item);
    if (!it) continue;
    const startedAt = ago(s.hoursAgo);
    it.status = 'out';
    it.outSince = startedAt;
    it.note = s.note;
    it.markedBy = s.by;
    events.push({ id: uid(), itemId: it.id, itemName: it.name, restaurantId: it.restaurantId, startedAt, note: s.note, markedBy: s.by });
  }
  for (const s of LOW_SEEDS) {
    const it = find(s.rest, s.item);
    if (!it || it.status === 'out') continue;
    it.status = 'low';
    it.lowCount = s.count;
    it.lowSince = ago(s.minutesAgo / 60);
    it.markedBy = s.by;
  }
  const staff: Staff[] = [OWNER, ...STAFF.map((p) => ({ ...p, active: true }))];
  return { restaurants: RESTAURANTS.map((r) => ({ ...r })), items, events, staff };
}

let memory: Store | null = null; // used when browser storage is unavailable

function load(): Store {
  const stored = readJSON<Store>(SAMPLE_KEY);
  if (stored) {
    memory = stored;
    return stored;
  }
  if (!memory) {
    memory = seed();
    writeJSON(SAMPLE_KEY, memory);
  }
  return memory;
}

function save(store: Store): void {
  memory = store;
  writeJSON(SAMPLE_KEY, store);
}

export function resetSampleData(): void {
  removeKey(SAMPLE_KEY);
  removeKey(GUESTS_KEY);
  memory = null;
  guestsMemory = null;
}

// The demo logins made on this phone and their passwords. Kept in memory as
// well, so the demo works where browser storage is blocked.
let guestsMemory: Record<string, string> | null = null;

function loadGuests(): Record<string, string> {
  if (!guestsMemory) guestsMemory = readJSON<Record<string, string>>(GUESTS_KEY) ?? {};
  return guestsMemory;
}

function saveGuests(guests: Record<string, string>): void {
  guestsMemory = guests;
  writeJSON(GUESTS_KEY, guests);
}

// The demo's made-up login. It exists from the moment it is shown: added to
// the sample staff with its password remembered, so it works typed into any
// sign-in box on this phone, not only through the demo's own button. The
// last few are kept; older guests drop off.
export function addDemoGuest(guest: Omit<Staff, 'active'>, password: string): void {
  const all = { ...loadGuests(), [guest.username]: password };
  const keep = Object.keys(all).slice(-MAX_GUESTS);
  const kept = Object.fromEntries(keep.map((u) => [u, all[u]]));
  const store = load();
  store.staff = store.staff.filter((p) => p.username !== guest.username && (!isGuestUsername(p.username) || keep.includes(p.username)));
  store.staff.push({ ...guest, active: true });
  save(store);
  saveGuests(kept);
}

export const demoGuestExists = (username: string): boolean => username in loadGuests();

let sessionMemory: Session | null | undefined;

function loadSession(): Session | null {
  if (sessionMemory !== undefined) return sessionMemory;
  sessionMemory = readJSON<Session>(SESSION_KEY);
  return sessionMemory;
}

function saveSession(s: Session | null): void {
  sessionMemory = s;
  if (s) writeJSON(SESSION_KEY, s);
  else removeKey(SESSION_KEY);
}

const toSession = (p: Staff): Session => ({ username: p.username, displayName: p.displayName, role: p.role, restaurantId: p.restaurantId });

// The 86 entry that is still open for this item gets its end time.
function closeOpenEvent(store: Store, itemId: string, now: string, by: string): void {
  const open = store.events.find((e) => e.itemId === itemId && !e.endedAt);
  if (open) {
    open.endedAt = now;
    open.clearedBy = by;
  }
}

export const mockApi: BoardApi = {
  mode: 'sample',

  async currentSession() {
    await wait(40);
    return loadSession();
  },

  async signIn(username, password): Promise<SignInResult> {
    await wait(300);
    const u = username.trim().toLowerCase();
    const person = load().staff.find((p) => p.username === u);
    if (isGuestUsername(u)) {
      // A demo login: it only exists on the phone that made it, and its password counts.
      if (!person) throw new Error('That demo login is not on this phone. Get a new one and it comes filled in, nothing to type.');
      if (loadGuests()[u] !== password) throw new Error('Incorrect username or password.');
    } else if (!person || !password) {
      throw new Error('No account with that username. In this preview, try omar, priya.m, marco.r, sam.t or lena.k with any password.');
    }
    if (!person.active) throw new Error('This account has been switched off. Ask a manager.');
    saveSession(toSession(person));
    return { status: 'done' };
  },

  async completeNewPassword() {
    await wait(100);
  },

  async signOut() {
    await wait(60);
    saveSession(null);
  },

  async accessStillValid(username) {
    const p = load().staff.find((s) => s.username === username);
    return !!p && p.active;
  },

  async listRestaurants() {
    await wait(60);
    return load().restaurants.map((r) => ({ ...r }));
  },

  async listItems(restaurantId) {
    await wait();
    // Airplane mode on the phone makes the board go stale, like a real outage would.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
    return load()
      .items.filter((i) => i.restaurantId === restaurantId)
      .map((i) => ({ ...i }));
  },

  async markOut(itemId, note, by) {
    await wait();
    const store = load();
    const it = store.items.find((i) => i.id === itemId);
    if (!it || it.status === 'out') return;
    const now = new Date().toISOString();
    it.status = 'out';
    it.outSince = now;
    it.note = note || undefined;
    it.markedBy = by;
    delete it.lowCount;
    delete it.lowSince;
    store.events.unshift({ id: uid(), itemId: it.id, itemName: it.name, restaurantId: it.restaurantId, startedAt: now, note: note || undefined, markedBy: by });
    save(store);
  },

  async markLow(itemId, count, by) {
    await wait();
    const store = load();
    const it = store.items.find((i) => i.id === itemId);
    if (!it) return;
    const now = new Date().toISOString();
    if (it.status === 'out') closeOpenEvent(store, itemId, now, by); // a few came back
    const wasLow = it.status === 'low';
    it.status = 'low';
    it.lowCount = Math.max(1, Math.round(count));
    it.lowSince = wasLow && it.lowSince ? it.lowSince : now;
    it.markedBy = by;
    delete it.outSince;
    delete it.note;
    save(store);
  },

  async markBack(itemId, by) {
    await wait();
    const store = load();
    const it = store.items.find((i) => i.id === itemId);
    if (!it || it.status === 'available') return;
    const now = new Date().toISOString();
    if (it.status === 'out') closeOpenEvent(store, itemId, now, by);
    it.status = 'available';
    delete it.outSince;
    delete it.note;
    delete it.markedBy;
    delete it.lowCount;
    delete it.lowSince;
    save(store);
  },

  async listHistory(restaurantId, days) {
    await wait();
    const cutoff = Date.now() - days * 24 * HOUR;
    const now = Date.now();
    return load()
      .events.filter((e) => e.restaurantId === restaurantId && (e.endedAt ? Date.parse(e.endedAt) : now) >= cutoff)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map((e) => ({ ...e }));
  },

  async listStaff() {
    await wait();
    return load().staff.map((p) => ({ ...p }));
  },

  async manageStaff(input: ManageStaffInput): Promise<ManageStaffResult> {
    await wait(250);
    const store = load();
    const username = cleanUsername(input.username);
    if (!username) throw new Error('Username is required.');
    const taken = (u: string) => store.staff.some((p) => p.username === u);
    if (input.action === 'suggestUsername') {
      const free = nextFreeUsername(username, taken);
      if (!free) throw new Error(`Every username from ${username} to ${username}99 is taken. Type a different one.`);
      return { ok: true, username: free };
    }
    if (input.action === 'create') {
      if (taken(username)) throw new Error(`The username ${username} is already taken.`);
      if (!input.displayName || !input.role || !input.restaurantId) throw new Error('Name, role and restaurant are required.');
      store.staff.push({ username, displayName: input.displayName.trim(), role: input.role, restaurantId: input.restaurantId, active: true });
      save(store);
      return input.password ? { ok: true, username, passwordSet: true } : { ok: true, username, temporaryPassword: passwordFrom(randomInt) };
    }
    const p = store.staff.find((s) => s.username === username);
    if (!p) throw new Error(`No staff record for ${username}.`);
    if (input.action === 'remove') {
      if (p.active) throw new Error('Switch the login off first, then remove it.');
      store.staff = store.staff.filter((s) => s.username !== username);
      save(store);
      return { ok: true, username, removed: true };
    }
    if (input.action === 'deactivate') p.active = false;
    if (input.action === 'reactivate') p.active = true;
    save(store);
    if (input.action === 'resetPassword') return { ok: true, username, temporaryPassword: passwordFrom(randomInt) };
    return { ok: true, username, active: p.active };
  },

  async seedDemo(): Promise<SeedResult> {
    await wait(300);
    resetSampleData();
    load();
    return { ok: true, restaurants: 3, items: 43, events: 14, staff: 60, demoPassword: 'any password' };
  },

  async repairData() {
    await wait(200);
    return { ok: true, items: 0, events: 0, staff: 0, openEvents: 0 };
  },

  // Alerts need a real server to send them. The preview only shows the screens.
  async pushPublicKey() {
    return null;
  },
  async subscribePush() {
    throw new Error('Alerts work in the real app, not in this preview.');
  },
  async unsubscribePush() {},

  // The owner's n8n settings live in this browser in the preview.
  async getIntegration(): Promise<IntegrationSettings> {
    await wait(60);
    const saved = readJSON<IntegrationSettings>(INTEGRATION_KEY);
    if (saved) return saved;
    const fresh: IntegrationSettings = { webhookUrl: '', key: newKey(), reportUrl: null };
    writeJSON(INTEGRATION_KEY, fresh);
    return fresh;
  },

  async saveIntegration(webhookUrl, key) {
    await wait(120);
    const prev = readJSON<IntegrationSettings>(INTEGRATION_KEY);
    const next: IntegrationSettings = { ...(prev ?? { reportUrl: null }), webhookUrl: webhookUrl.trim(), key, reportUrl: null };
    writeJSON(INTEGRATION_KEY, next);
    return next;
  },

  async testWebhook() {
    await wait(300);
    const summary = 'Preview only. On the real site this sends a sample 86 to your n8n.';
    const prev = readJSON<IntegrationSettings>(INTEGRATION_KEY);
    if (prev) writeJSON(INTEGRATION_KEY, { ...prev, lastTestAt: new Date().toISOString(), lastTestResult: summary });
    return { ok: false, summary };
  },
};

const INTEGRATION_KEY = 'eightysix.sample.integration';
