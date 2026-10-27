import { describe, expect, it } from 'vitest';
import { Refused, actorFromIdentity, checkCreate, checkDeactivate, checkManage, checkRemove, checkSuggest, cleanUsername, tempPassword, type PersonRecord } from './rules';
import { passesPolicy } from '../../../shared/logins';

let calls = 0;

const owner = actorFromIdentity({ username: 'omar', groups: ['owner'] });
const mainManager = actorFromIdentity({ username: 'priya.m', groups: ['main-manager'] });
const mainServer = actorFromIdentity({ username: 'sam.t', groups: ['main-server'] });

const person = (over: Partial<PersonRecord> = {}): PersonRecord => ({
  username: 'bea.r',
  displayName: 'Bea R.',
  role: 'server',
  restaurantId: 'main',
  active: true,
  ...over,
});

describe('who is calling', () => {
  it('reads the owner and managers from the groups', () => {
    expect(owner.isOwner).toBe(true);
    expect(mainManager).toMatchObject({ isOwner: false, managerOf: ['main'] });
    expect(mainServer.managerOf).toEqual([]);
  });

  it('refuses a missing login', () => {
    expect(() => actorFromIdentity(null)).toThrow(Refused);
    expect(() => actorFromIdentity({ username: '' })).toThrow(Refused);
  });
});

describe('creating a login', () => {
  const good = { displayName: 'New Person', role: 'server', restaurantId: 'main', password: '' };

  it('a manager can add staff at their own restaurant only', () => {
    expect(checkCreate(mainManager, good)).toEqual({ role: 'server', group: 'main-server', permanent: false });
    expect(() => checkCreate(mainManager, { ...good, restaurantId: 'water' })).toThrow('your own restaurant');
  });

  it('the owner can add staff anywhere', () => {
    expect(checkCreate(owner, { ...good, restaurantId: 'counter', role: 'kitchen' })).toMatchObject({ group: 'counter-kitchen' });
  });

  it('a chosen password is kept for good, a short one is refused', () => {
    expect(checkCreate(owner, { ...good, password: 'Strong-Pass-1!' }).permanent).toBe(true);
    expect(() => checkCreate(owner, { ...good, password: 'short' })).toThrow('at least 8 characters');
  });

  it('needs a name, a real role and a real restaurant', () => {
    expect(() => checkCreate(owner, { ...good, displayName: '  ' })).toThrow('Name is required');
    expect(() => checkCreate(owner, { ...good, role: 'owner' })).toThrow('Role must be');
    expect(() => checkCreate(owner, { ...good, restaurantId: 'nowhere' })).toThrow('Pick a restaurant');
  });

  it('servers cannot add anyone (they are not managers of anything)', () => {
    expect(() => checkCreate(mainServer, good)).toThrow(Refused);
  });
});

describe('changing an existing person', () => {
  it('managers stay inside their restaurant, owner goes anywhere', () => {
    expect(() => checkManage(mainManager, person())).not.toThrow();
    expect(() => checkManage(mainManager, person({ restaurantId: 'water' }))).toThrow('your own restaurant');
    expect(() => checkManage(owner, person({ restaurantId: 'water' }))).not.toThrow();
  });

  it('only the owner touches the owner', () => {
    const boss = person({ username: 'omar', role: 'owner', restaurantId: 'all' });
    expect(() => checkManage(mainManager, boss)).toThrow('Only the owner');
    expect(() => checkManage(owner, boss)).not.toThrow();
  });

  it('nobody switches themselves off', () => {
    expect(() => checkDeactivate(mainManager, person({ username: 'priya.m', role: 'manager' }))).toThrow('your own account');
    expect(() => checkDeactivate(mainManager, person())).not.toThrow();
  });

  it('remove only works for a switched-off login that was never used', () => {
    expect(() => checkRemove(owner, person({ active: true }), 'FORCE_CHANGE_PASSWORD')).toThrow('Switch the login off first');
    expect(() => checkRemove(owner, person({ active: false }), 'CONFIRMED')).toThrow('has signed in before');
    expect(() => checkRemove(owner, person({ active: false }), 'FORCE_CHANGE_PASSWORD')).not.toThrow();
    expect(() => checkRemove(owner, person({ active: false }), undefined)).not.toThrow(); // login already gone, record left over
  });
});

describe('usernames and temporary passwords', () => {
  it('cleans what managers type', () => {
    expect(cleanUsername('  Ryan.Keiper ')).toBe('ryan.keiper');
    expect(cleanUsername('Marco R!')).toBe('marcor');
  });

  it('cleans accents into plain letters, like the app does', () => {
    expect(cleanUsername('José.Peña')).toBe('jose.pena');
  });

  it('temporary passwords pass the pool policy and read out loud', () => {
    expect(tempPassword((n) => [0, 0, 3821, 0][calls++ % 4] % n)).toBe('Basil-Tray-4821!');
    for (let i = 0; i < 200; i++) {
      const p = tempPassword(); // real randomness from Node's crypto
      expect(p).toMatch(/^[A-Z][a-z]+-[A-Z][a-z]+-\d{4}[!?]$/);
      expect(passesPolicy(p)).toBe(true);
    }
  });

  it('they are not all the same', () => {
    const seen = new Set(Array.from({ length: 50 }, () => tempPassword()));
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe('asking for a free username', () => {
  it('the owner and managers may ask, nobody else', () => {
    expect(() => checkSuggest(actorFromIdentity({ username: 'omar', groups: ['owner'] }))).not.toThrow();
    expect(() => checkSuggest(actorFromIdentity({ username: 'priya.m', groups: ['main-manager'] }))).not.toThrow();
    expect(() => checkSuggest(actorFromIdentity({ username: 'sam.t', groups: ['main-server'] }))).toThrow(Refused);
    expect(() => checkSuggest(actorFromIdentity({ username: 'marco.r', groups: ['main-kitchen'] }))).toThrow(Refused);
  });
});
