// Sample data for the prototype. It lives in this browser's storage so taps
// persist on the device, and every read goes back to storage so two tabs on
// the same phone see each other's changes within one refresh.
import type { BoardApi } from './types';
import type { EightySixEvent, MenuItem, Restaurant } from '../types';
import { readJSON, removeKey, writeJSON } from '../lib/storage';

export const SAMPLE_KEY = 'eightysix.sample.v1';

interface Store {
  restaurants: Restaurant[];
  items: MenuItem[];
  events: EightySixEvent[];
}

const RESTAURANTS: Restaurant[] = [
  { id: 'main', name: 'Main Street', kind: 'Full service' },
  { id: 'water', name: 'Waterfront', kind: 'Full service' },
  { id: 'counter', name: 'The Counter', kind: 'Fast casual' },
];

type Row = [category: string, name: string, vendor?: string];

const MENUS: Record<string, Row[]> = {
  main: [
    ['Starters', 'Burrata & Peach', 'Blue Ridge Produce'],
    ['Starters', 'Tuna Crudo', 'Chesapeake Seafood Co.'],
    ['Starters', 'Crispy Calamari', 'Chesapeake Seafood Co.'],
    ['Starters', 'Caesar', 'Blue Ridge Produce'],
    ['Pasta', 'Tagliatelle Bolognese', 'Capital Meats'],
    ['Pasta', 'Cacio e Pepe'],
    ['Pasta', 'Lobster Ravioli', 'Chesapeake Seafood Co.'],
    ['Mains', 'Pan-Roasted Halibut', 'Chesapeake Seafood Co.'],
    ['Mains', 'Braised Short Rib', 'Capital Meats'],
    ['Mains', 'Whole Branzino', 'Chesapeake Seafood Co.'],
    ['Mains', 'Ribeye 16 oz', 'Capital Meats'],
    ['Mains', 'Roast Chicken', 'Capital Meats'],
    ['Desserts', 'Tiramisu', 'Metro Bakery'],
    ['Desserts', 'Olive Oil Cake', 'Metro Bakery'],
    ['Bar', 'Espresso Martini'],
    ['Bar', 'Pinot Noir (glass)', 'Potomac Wine & Spirits'],
    ['Bar', 'Negroni'],
  ],
  water: [
    ['Raw Bar', 'Oysters, East Coast', 'Chesapeake Seafood Co.'],
    ['Raw Bar', 'Oysters, West Coast', 'Chesapeake Seafood Co.'],
    ['Raw Bar', 'Shrimp Cocktail', 'Chesapeake Seafood Co.'],
    ['Starters', 'Crab Cake', 'Chesapeake Seafood Co.'],
    ['Starters', 'Clam Chowder', 'Chesapeake Seafood Co.'],
    ['Mains', 'Lobster Roll', 'Chesapeake Seafood Co.'],
    ['Mains', 'Grilled Swordfish', 'Chesapeake Seafood Co.'],
    ['Mains', 'Seared Scallops', 'Chesapeake Seafood Co.'],
    ['Mains', 'Steak Frites', 'Capital Meats'],
    ['Mains', 'Fish & Chips', 'Chesapeake Seafood Co.'],
    ['Sides', 'Truffle Fries', 'Blue Ridge Produce'],
    ['Sides', 'Grilled Asparagus', 'Blue Ridge Produce'],
    ['Bar', 'Sancerre (glass)', 'Potomac Wine & Spirits'],
    ['Bar', 'Aperol Spritz', 'Potomac Wine & Spirits'],
  ],
  counter: [
    ['Bowls', 'Chicken Shawarma Bowl', 'Capital Meats'],
    ['Bowls', 'Falafel Bowl', 'Blue Ridge Produce'],
    ['Bowls', 'Steak Bowl', 'Capital Meats'],
    ['Sandwiches', 'Chicken Pesto', 'Metro Bakery'],
    ['Sandwiches', 'Italian Sub', 'Metro Bakery'],
    ['Sandwiches', 'Veggie Wrap', 'Blue Ridge Produce'],
    ['Sides', 'Fries'],
    ['Sides', 'Side Salad', 'Blue Ridge Produce'],
    ['Sides', 'Hummus & Pita', 'Metro Bakery'],
    ['Drinks', 'Lemonade'],
    ['Drinks', 'Cold Brew'],
    ['Drinks', 'Sparkling Water'],
  ],
};

// Items that are out right now when the sample data is first created.
interface OpenSeed {
  rest: string;
  item: string;
  hoursAgo: number;
  note: string;
  by: string;
}
// Past 86s, already back on.
interface ClosedSeed extends OpenSeed {
  hours: number; // how long it was out
  clearedBy: string;
}

const OPEN: OpenSeed[] = [
  { rest: 'main', item: 'Pan-Roasted Halibut', hoursAgo: 3.1, note: 'Chesapeake shorted the order, back Tuesday', by: 'Marco R.' },
  { rest: 'main', item: 'Burrata & Peach', hoursAgo: 0.7, note: 'Sold out', by: 'Marco R.' },
  { rest: 'water', item: 'Oysters, West Coast', hoursAgo: 27, note: "Didn't come in", by: 'Dev P.' },
  { rest: 'counter', item: 'Cold Brew', hoursAgo: 2.2, note: 'Machine down', by: 'Alex J.' },
];

const CLOSED: ClosedSeed[] = [
  { rest: 'main', item: 'Braised Short Rib', hoursAgo: 50, hours: 3.5, note: 'Sold out', by: 'Marco R.', clearedBy: 'Priya M.' },
  { rest: 'main', item: 'Tiramisu', hoursAgo: 74, hours: 2, note: 'Sold out', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Burrata & Peach', hoursAgo: 100, hours: 1.5, note: 'Sold out', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Pan-Roasted Halibut', hoursAgo: 150, hours: 4.2, note: 'Vendor short', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Lobster Ravioli', hoursAgo: 220, hours: 26, note: "Didn't come in", by: 'Marco R.', clearedBy: 'Priya M.' },
  { rest: 'water', item: 'Lobster Roll', hoursAgo: 26, hours: 2.5, note: 'Sold out', by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'water', item: 'Oysters, West Coast', hoursAgo: 120, hours: 30, note: "Didn't come in", by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'water', item: 'Seared Scallops', hoursAgo: 170, hours: 3, note: 'Quality, pulled', by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'counter', item: 'Cold Brew', hoursAgo: 96, hours: 5, note: 'Machine down', by: 'Alex J.', clearedBy: 'Alex J.' },
  { rest: 'counter', item: 'Falafel Bowl', hoursAgo: 30, hours: 1, note: 'Sold out', by: 'Alex J.', clearedBy: 'Alex J.' },
];

const HOUR = 3_600_000;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const uid = () => Math.random().toString(36).slice(2, 10);
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const wait = (ms = 120) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function seed(): Store {
  const items: MenuItem[] = [];
  for (const r of RESTAURANTS) {
    for (const [category, name, vendor] of MENUS[r.id]) {
      items.push({ id: `${r.id}-${slug(name)}`, restaurantId: r.id, name, category, vendor, status: 'available' });
    }
  }
  const find = (rest: string, name: string) => items.find((i) => i.restaurantId === rest && i.name === name);
  const events: EightySixEvent[] = [];

  for (const s of CLOSED) {
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
  for (const s of OPEN) {
    const it = find(s.rest, s.item);
    if (!it) continue;
    const startedAt = ago(s.hoursAgo);
    it.status = 'out';
    it.outSince = startedAt;
    it.note = s.note;
    it.markedBy = s.by;
    events.push({ id: uid(), itemId: it.id, itemName: it.name, restaurantId: it.restaurantId, startedAt, note: s.note, markedBy: s.by });
  }
  return { restaurants: RESTAURANTS, items, events };
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

export const mockApi: BoardApi = {
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
    store.events.unshift({
      id: uid(),
      itemId: it.id,
      itemName: it.name,
      restaurantId: it.restaurantId,
      startedAt: now,
      note: note || undefined,
      markedBy: by,
    });
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
};
