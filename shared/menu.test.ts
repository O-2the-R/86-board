import { describe, expect, it } from 'vitest';
import { categoryFor, menuFromLists, planMenu, type BoardRow } from './menu';
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
