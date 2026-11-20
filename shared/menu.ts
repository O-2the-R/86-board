// A real restaurant's 86 board gets its menu from the same lists Ask answers
// from, so the two never disagree: an item 86'd on the board is the item Ask
// knows. This turns the lists into board rows and works out what has to
// change on the board to match them. No database here; the board function
// does the changing.
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

export interface MenuPlan {
  create: (WantedRow & { id: string })[];
  update: (WantedRow & { id: string })[]; // on the board already, under another section, spelling or place
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
