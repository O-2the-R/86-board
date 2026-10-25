import { describe, expect, it } from 'vitest';
import { CLOSED_SEEDS, LOW_SEEDS, MENUS, OPEN_SEEDS, RESTAURANTS, STAFF, editorGroupsFor, groupFor, itemIdFor, usernameFor } from './sample-data';

describe('usernames and ids', () => {
  it('turns a display name into a login', () => {
    expect(usernameFor('Marco R.')).toBe('marco.r');
    expect(usernameFor('  Ryan Keiper ')).toBe('ryan.keiper');
    expect(usernameFor('Priya M.')).toBe('priya.m');
  });

  it('item ids are stable and safe', () => {
    expect(itemIdFor('main', 'Pan-Roasted Halibut')).toBe('main-pan-roasted-halibut');
    expect(itemIdFor('water', 'Oysters, East Coast')).toBe('water-oysters-east-coast');
    expect(itemIdFor('main', 'Ribeye 16 oz')).toBe('main-ribeye-16-oz');
  });

  it('groups follow restaurant-role', () => {
    expect(groupFor('main', 'kitchen')).toBe('main-kitchen');
    expect(editorGroupsFor('water')).toEqual(['water-manager', 'water-kitchen']);
  });
});

describe('the roster', () => {
  it('is 20 people per restaurant: 3 managers, 7 kitchen, 7 servers, 3 hosts', () => {
    for (const r of RESTAURANTS) {
      const here = STAFF.filter((p) => p.restaurantId === r.id);
      expect(here).toHaveLength(20);
      const count = (role: string) => here.filter((p) => p.role === role).length;
      expect([count('manager'), count('kitchen'), count('server'), count('host')]).toEqual([3, 7, 7, 3]);
    }
    expect(STAFF).toHaveLength(60);
  });

  it('has no duplicate usernames', () => {
    expect(new Set(STAFF.map((p) => p.username)).size).toBe(STAFF.length);
  });
});

describe('the seeded 86s point at real menu items', () => {
  const has = (rest: string, item: string) => MENUS[rest]?.some(([, name]) => name === item);
  it('open, closed and running-low seeds all exist on the menu', () => {
    for (const s of [...OPEN_SEEDS, ...CLOSED_SEEDS]) expect(has(s.rest, s.item), `${s.rest}: ${s.item}`).toBe(true);
    for (const s of LOW_SEEDS) expect(has(s.rest, s.item), `${s.rest}: ${s.item}`).toBe(true);
  });

  it('nothing is seeded both out and running low', () => {
    const out = new Set(OPEN_SEEDS.map((s) => `${s.rest}:${s.item}`));
    for (const s of LOW_SEEDS) expect(out.has(`${s.rest}:${s.item}`)).toBe(false);
  });
});
