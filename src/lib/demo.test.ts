import { describe, expect, it } from 'vitest';
import { DEMO_ROLES, demoUsername } from './demo';

describe('the public demo', () => {
  it('makes guest logins like guest.kitchen.4821', () => {
    expect(demoUsername('kitchen', () => 3821)).toBe('guest.kitchen.4821');
    expect(demoUsername('owner', () => 0)).toBe('guest.owner.1000');
    expect(demoUsername('server', (n) => n - 1)).toBe('guest.server.9999');
  });

  it('offers kitchen, server, manager and owner, each with a place to land', () => {
    expect(DEMO_ROLES.map((r) => r.role)).toEqual(['kitchen', 'server', 'manager', 'owner']);
    for (const r of DEMO_ROLES) expect(r.restaurantId).toBe(r.role === 'owner' ? 'all' : 'main');
  });
});
