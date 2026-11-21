// A real restaurant's 86 board gets its menu from the same lists Ask answers
// from, so the two never disagree: an item 86'd on the board is the item Ask
// knows. This turns the lists into board rows, works out what has to change
// on the board to match them, and makes the changes in the right order. The
// database itself is passed in (the board function has the real one), so the
// tests run all of it in memory.
import type { AssistantCatalog, AssistantItem } from './assistant/catalog';
import { norm } from './assistant/catalog';
import { itemIdFor } from './sample-data';

export interface WantedRow {
  name: string;
  category: string;
  sortOrder: number;
}

// What the board holds now, as far as this needs to know.
export interface BoardRow {
  id: string;
  name: string;
  category: string;
  sortOrder?: number | null;
  status: string;
  openEventId?: string | null;
}

// Food keeps its own section ("Antipasti"). Drinks and wine say what they
// are, because "Seasonal" or "Red" alone means little on a board.
export const categoryFor = (item: Pick<AssistantItem, 'kind' | 'section'>): string =>
  item.kind === 'wine' ? `Wine: ${item.section}` : item.kind === 'drink' ? `Drinks: ${item.section}` : item.section;

// One board row per list item, in the lists' own order, under the name the
// item has on the board. Two items that share a board name become one row.
export function menuFromLists(catalog: Pick<AssistantCatalog, 'items'>): WantedRow[] {
  const seen = new Set<string>();
  const rows: WantedRow[] = [];
  for (const item of catalog.items) {
    const name = item.board ?? item.name;
    const key = norm(name);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, category: categoryFor(item), sortOrder: rows.length });
  }
  return rows;
}

export type PlannedRow = WantedRow & { id: string };

export interface MenuPlan {
  create: PlannedRow[];
  update: PlannedRow[]; // on the board already, under another section, spelling or place
  remove: BoardRow[]; // on the board, no longer on the lists
}

// Items are matched by name the way the chat matches them (case, accents and
// punctuation aside), so an item that stays keeps its state: an 86 survives
// a new wine list.
export function planMenu(restaurantId: string, existing: BoardRow[], wanted: WantedRow[]): MenuPlan {
  const onBoard = new Map<string, BoardRow>();
  for (const row of existing) if (!onBoard.has(norm(row.name))) onBoard.set(norm(row.name), row);
  const usedIds = new Set(existing.map((r) => r.id));
  const kept = new Set<string>();
  const plan: MenuPlan = { create: [], update: [], remove: [] };
  for (const w of wanted) {
    const key = norm(w.name);
    const have = onBoard.get(key);
    if (have) {
      kept.add(have.id);
      if (have.name !== w.name || have.category !== w.category || have.sortOrder !== w.sortOrder) plan.update.push({ id: have.id, ...w });
      continue;
    }
    let id = itemIdFor(restaurantId, w.name);
    for (let n = 2; usedIds.has(id); n++) id = `${itemIdFor(restaurantId, w.name)}-${n}`;
    usedIds.add(id);
    plan.create.push({ id, ...w });
  }
  plan.remove = existing.filter((r) => !kept.has(r.id));
  return plan;
}

// The board's table, as far as this needs it. Each call says what it found,
// because the board is read a moment before it is changed, and that read can
// be a beat behind: a row removed a second ago can still be listed, and a
// row just added can be missing.
export interface MenuDb {
  create(row: PlannedRow): Promise<boolean>; // false: a row with that id is there already
  update(row: PlannedRow): Promise<boolean>; // false: the row is gone
  remove(row: BoardRow): Promise<void>; // fine when the row is already gone
}

async function inBatches<T>(rows: T[], size: number, fn: (row: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await Promise.all(rows.slice(i, i + size).map(fn));
}

// Carries a plan out: what is gone leaves first, then what stays is brought
// in line, then what is new is added. A row that turns out to be gone is
// added afresh; a row that turns out to be there is brought in line. So a
// stale read, or two people pressing the button at once, still ends with the
// board matching the lists.
export async function applyMenu(db: MenuDb, plan: MenuPlan, batch = 8): Promise<void> {
  await inBatches(plan.remove, batch, (row) => db.remove(row));
  await inBatches(plan.update, batch, async (row) => {
    if (!(await db.update(row))) await db.create(row);
  });
  await inBatches(plan.create, batch, async (row) => {
    if (!(await db.create(row))) await db.update(row);
  });
}
