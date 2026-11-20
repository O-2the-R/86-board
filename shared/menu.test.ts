import { describe, expect, it } from 'vitest';
import { applyMenu, categoryFor, menuFromLists, planMenu, type BoardRow, type MenuDb, type PlannedRow } from './menu';
import { SAMPLE_CATALOGS } from './assistant/sample';
import type { AssistantItem } from './assistant/catalog';

const item = (name: string, kind: AssistantItem['kind'], section: string, board?: string): AssistantItem => ({ name, kind, section, board });
const row = (id: string, name: string, category: string, sortOrder: number, status = 'available'): BoardRow => ({ id, name, category, sortOrder, status });

describe('the board menu that comes from the lists', () => {
  it('has one row per list item, in the same order', () => {
    const rows = menuFromLists({ items: [item('Calamari', 'food', 'Antipasti'), item('Negroni', 'drink', 'Negronis'), item('Chianti', 'wine', 'Red')] });
    expect(rows).toEqual([
      { name: 'Calamari', category: 'Antipasti', sortOrder: 0 },
      { name: 'Negroni', category: 'Drinks: Negronis', sortOrder: 1 },
      { name: 'Chianti', category: 'Wine: Red', sortOrder: 2 },
    ]);
    expect(categoryFor({ kind: 'drink', section: 'Seasonal' })).toBe('Drinks: Seasonal');
  });

  it('uses the name the item has on the board, once', () => {
    const rows = menuFromLists({ items: [item('Sancerre', 'wine', 'White', 'Sancerre (glass)'), item('Sancerre, bottle', 'wine', 'White', 'Sancerre (glass)')] });
    expect(rows.map((r) => r.name)).toEqual(['Sancerre (glass)']);
  });

  it('covers every item of every sample list', () => {
    for (const lists of Object.values(SAMPLE_CATALOGS)) expect(menuFromLists(lists)).toHaveLength(lists.items.length);
  });
});

describe('what has to change on the board', () => {
  const wanted = menuFromLists({ items: [item('Calamari', 'food', 'Antipasti'), item('Tiramisù', 'food', 'Dessert'), item('Negroni', 'drink', 'Negronis')] });

  it('fills an empty board', () => {
    const plan = planMenu('main', [], wanted);
    expect(plan.create.map((c) => c.id)).toEqual(['main-calamari', 'main-tiramis', 'main-negroni']);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('changes nothing when the board already matches', () => {
    const board = planMenu('main', [], wanted).create.map((c) => row(c.id, c.name, c.category, c.sortOrder));
    expect(planMenu('main', board, wanted)).toEqual({ create: [], update: [], remove: [] });
  });

  it("keeps an item that stays, with its state, and only moves or re-spells it", () => {
    const board = [row('main-tiramisu', 'Tiramisu', 'Desserts', 9, 'out'), row('main-old', 'Short Rib', 'Mains', 3)];
    const plan = planMenu('main', board, wanted);
    expect(plan.update).toEqual([{ id: 'main-tiramisu', name: 'Tiramisù', category: 'Dessert', sortOrder: 1 }]);
    expect(plan.create.map((c) => c.name)).toEqual(['Calamari', 'Negroni']);
    expect(plan.remove.map((r) => r.name)).toEqual(['Short Rib']);
  });

  it('never gives a new item the id of a row that is already there', () => {
    const board = [row('main-calamari', 'Fried Squid', 'Starters', 0)];
    const plan = planMenu('main', board, wanted);
    expect(plan.create[0]).toMatchObject({ name: 'Calamari', id: 'main-calamari-2' });
    expect(plan.remove.map((r) => r.id)).toEqual(['main-calamari']);
  });

  it('takes two board rows with the same name as one item and removes the spare', () => {
    const board = [row('a', 'Negroni', 'Drinks: Negronis', 2), row('b', 'NEGRONI', 'Bar', 7)];
    const plan = planMenu('main', board, wanted);
    expect(plan.update).toEqual([]);
    expect(plan.remove.map((r) => r.id)).toEqual(['b']);
  });
});

describe('making the changes on the board', () => {
  const wanted = menuFromLists({ items: [item('Calamari', 'food', 'Antipasti'), item('Tiramisù', 'food', 'Dessert'), item('Negroni', 'drink', 'Negronis')] });

  // A board in memory. It answers the way the real table does: a row that is
  // already there cannot be made again, and a row that is gone cannot be changed.
  function board(start: BoardRow[]) {
    const rows = new Map(start.map((r) => [r.id, { ...r }]));
    const calls: string[] = [];
    const db: MenuDb = {
      create: async (r: PlannedRow) => {
        calls.push(`create ${r.id}`);
        if (rows.has(r.id)) return false;
        rows.set(r.id, { ...r, status: 'available' });
        return true;
      },
      update: async (r: PlannedRow) => {
        calls.push(`update ${r.id}`);
        const now = rows.get(r.id);
        if (!now) return false;
        Object.assign(now, r);
        return true;
      },
      remove: async (r: BoardRow) => {
        calls.push(`remove ${r.id}`);
        rows.delete(r.id);
      },
    };
    const names = () => [...rows.values()].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((r) => `${r.name} | ${r.category} | ${r.status}`);
    return { db, rows, calls, names };
  }

  it('ends with the board matching the lists, and keeps the state of what stays', async () => {
    const start = [row('main-tiramisu', 'Tiramisu', 'Desserts', 9, 'out'), row('main-old', 'Short Rib', 'Mains', 3)];
    const b = board(start);
    await applyMenu(b.db, planMenu('main', start, wanted));
    expect(b.names()).toEqual(['Calamari | Antipasti | available', "Tiramisù | Dessert | out", 'Negroni | Drinks: Negronis | available']);
    // what is gone leaves before anything is added
    expect(b.calls[0]).toBe('remove main-old');
  });

  it('adds a row afresh when the one it meant to change is already gone', async () => {
    // the board was read a moment ago; since then the Tiramisu row was removed
    const read = [row('main-tiramisu', 'Tiramisu', 'Desserts', 9)];
    const b = board([]);
    await applyMenu(b.db, planMenu('main', read, wanted));
    expect(b.calls).toContain('update main-tiramisu');
    expect(b.names()).toEqual(['Calamari | Antipasti | available', 'Tiramisù | Dessert | available', 'Negroni | Drinks: Negronis | available']);
  });

  it('brings a row in line when the one it meant to add is already there', async () => {
    // the read missed a Negroni row that someone else added a moment ago
    const b = board([row('main-negroni', 'Negroni', 'Bar', 40, 'low')]);
    await applyMenu(b.db, planMenu('main', [], wanted));
    expect(b.rows.get('main-negroni')).toMatchObject({ category: 'Drinks: Negronis', sortOrder: 2, status: 'low' });
    expect(b.rows.size).toBe(3);
  });

  it('is not troubled by a row that was removed twice', async () => {
    const read = [row('main-old', 'Short Rib', 'Mains', 3)];
    const b = board([]); // the row is gone already
    await applyMenu(b.db, planMenu('main', read, wanted));
    expect(b.rows.size).toBe(3);
  });

  it('gives the same board when it is run again', async () => {
    const b = board([]);
    await applyMenu(b.db, planMenu('main', [], wanted));
    const once = b.names();
    await applyMenu(b.db, planMenu('main', [...b.rows.values()], wanted));
    expect(b.names()).toEqual(once);
    expect(b.calls.filter((c) => c.startsWith('create'))).toHaveLength(3);
  });

  it('works through a long menu in small batches', async () => {
    const many = menuFromLists({ items: Array.from({ length: 133 }, (_, i) => item(`Dish ${i + 1}`, 'food', 'Menu')) });
    const b = board([]);
    await applyMenu(b.db, planMenu('main', [], many));
    expect(b.rows.size).toBe(133);
  });
});
