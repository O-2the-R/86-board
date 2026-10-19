// Sample mode. Everything lives in this browser's storage, so the app can be
// tried anywhere without a backend. Sign in as any sample person (omar,
// priya.m, marco.r, sam.t, lena.k ...) with any password.
import type { BoardApi, ManageStaffInput, ManageStaffResult, SeedResult, SignInResult } from './types';
import type { EightySixEvent, MenuItem, Restaurant, Session, Staff } from '../types';
import { readJSON, removeKey, writeJSON } from '../lib/storage';
import { CLOSED_SEEDS, MENUS, OPEN_SEEDS, RESTAURANTS, STAFF, itemIdFor } from '../../shared/sample-data';

export const SAMPLE_KEY = 'eightysix.sample.v2';
const SESSION_KEY = 'eightysix.sample.session';

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
  memory = null;
}

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
    if (!person || !password) throw new Error('No account with that username. In this preview, try omar, priya.m, marco.r, sam.t or lena.k with any password.');
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
    store.events.unshift({ id: uid(), itemId: it.id, itemName: it.name, restaurantId: it.restaurantId, startedAt: now, note: note || undefined, markedBy: by });
    save(store);
  },

  async markBack(itemId, by) {
    await wait();
    const store = load();
    const it = store.items.find((i) => i.id === itemId);
    if (!it || it.status !== 'out') return;
    const now = new Date().toISOString();
    const open = store.events.find((e) => e.itemId === itemId && !e.endedAt);
    if (open) {
      open.endedAt = now;
      open.clearedBy = by;
    }
    it.status = 'available';
    delete it.outSince;
    delete it.note;
    delete it.markedBy;
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
    const username = input.username.trim().toLowerCase();
    if (input.action === 'create') {
      if (store.staff.some((p) => p.username === username)) throw new Error(`The username ${username} is already taken.`);
      if (!input.displayName || !input.role || !input.restaurantId) throw new Error('Name, role and restaurant are required.');
      store.staff.push({ username, displayName: input.displayName.trim(), role: input.role, restaurantId: input.restaurantId, active: true });
      save(store);
      return { ok: true, username, temporaryPassword: 'Board-4821!' };
    }
    const p = store.staff.find((s) => s.username === username);
    if (!p) throw new Error(`No staff record for ${username}.`);
    if (input.action === 'deactivate') p.active = false;
    if (input.action === 'reactivate') p.active = true;
    save(store);
    if (input.action === 'resetPassword') return { ok: true, username, temporaryPassword: 'Board-7306!' };
    return { ok: true, username, active: p.active };
  },

  async seedDemo(): Promise<SeedResult> {
    await wait(300);
    resetSampleData();
    load();
    return { ok: true, restaurants: 3, items: 43, events: 14, staff: 60, demoPassword: 'any password' };
  },
};
