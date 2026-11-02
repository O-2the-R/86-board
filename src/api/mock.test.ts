import { beforeEach, describe, expect, it } from 'vitest';
import { addDemoGuest, demoGuestExists, mockApi, resetSampleData } from './mock';

// No browser storage here, so the sample data lives in memory, exactly as it
// does in a browser that blocks storage.
beforeEach(() => resetSampleData());

describe('demo logins', () => {
  it('exist the moment they are made, so typing them into a sign-in box works', async () => {
    addDemoGuest({ username: 'guest.kitchen.4821', displayName: 'Guest', role: 'kitchen', restaurantId: 'main' }, 'Basil-Tray-4821!');
    expect(demoGuestExists('guest.kitchen.4821')).toBe(true);
    await expect(mockApi.signIn('guest.kitchen.4821', 'Basil-Tray-4821!')).resolves.toEqual({ status: 'done' });
    const session = await mockApi.currentSession();
    expect(session).toMatchObject({ username: 'guest.kitchen.4821', role: 'kitchen', restaurantId: 'main' });
  });

  it('are typed however the person types them', async () => {
    addDemoGuest({ username: 'guest.owner.1000', displayName: 'Guest', role: 'owner', restaurantId: 'all' }, 'Fennel-Pass-7302?');
    await expect(mockApi.signIn('  Guest.Owner.1000 ', 'Fennel-Pass-7302?')).resolves.toEqual({ status: 'done' });
  });

  it('need their password, unlike the sample people', async () => {
    addDemoGuest({ username: 'guest.server.5555', displayName: 'Guest', role: 'server', restaurantId: 'main' }, 'Lemon-Crab-5555!');
    await expect(mockApi.signIn('guest.server.5555', 'wrong')).rejects.toThrow('Incorrect username or password.');
    await expect(mockApi.signIn('guest.server.5555', '')).rejects.toThrow('Incorrect username or password.');
    await expect(mockApi.signIn('sam.t', 'anything')).resolves.toEqual({ status: 'done' });
  });

  it('say so when a demo login was made on another phone', async () => {
    await expect(mockApi.signIn('guest.kitchen.9999', 'Basil-Tray-9999!')).rejects.toThrow('not on this phone');
    expect(demoGuestExists('guest.kitchen.9999')).toBe(false);
  });

  it('keep the last five, so an older login stops working', async () => {
    for (let i = 0; i < 7; i++) {
      addDemoGuest({ username: `guest.kitchen.${1000 + i}`, displayName: 'Guest', role: 'kitchen', restaurantId: 'main' }, `Word-Word-${1000 + i}!`);
    }
    expect(demoGuestExists('guest.kitchen.1000')).toBe(false);
    expect(demoGuestExists('guest.kitchen.1001')).toBe(false);
    expect(demoGuestExists('guest.kitchen.1002')).toBe(true);
    expect(demoGuestExists('guest.kitchen.1006')).toBe(true);
    const staff = await mockApi.listStaff();
    expect(staff.filter((p) => p.username.startsWith('guest.')).map((p) => p.username)).toEqual(['guest.kitchen.1002', 'guest.kitchen.1003', 'guest.kitchen.1004', 'guest.kitchen.1005', 'guest.kitchen.1006']);
    await expect(mockApi.signIn('guest.kitchen.1000', 'Word-Word-1000!')).rejects.toThrow('not on this phone');
    await expect(mockApi.signIn('guest.kitchen.1006', 'Word-Word-1006!')).resolves.toEqual({ status: 'done' });
  });

  it('are gone after a reset', async () => {
    addDemoGuest({ username: 'guest.manager.2222', displayName: 'Guest', role: 'manager', restaurantId: 'main' }, 'Mint-Dill-2222!');
    resetSampleData();
    expect(demoGuestExists('guest.manager.2222')).toBe(false);
    await expect(mockApi.signIn('guest.manager.2222', 'Mint-Dill-2222!')).rejects.toThrow('not on this phone');
  });
});

describe('vendor notes in the sample data', () => {
  it('knows each restaurant’s suppliers, with made-up addresses', async () => {
    const main = await mockApi.listVendors('main');
    expect(main.map((v) => v.name)).toContain('Chesapeake Seafood Co.');
    expect(main.every((v) => v.email.endsWith('.example'))).toBe(true);
    const counter = await mockApi.listVendors('counter');
    expect(counter.map((v) => v.name)).not.toContain('Chesapeake Seafood Co.'); // not on its menu
  });

  it('starts with items out three days or more, so the note can be tried', async () => {
    const items = await mockApi.listItems('main');
    const branzino = items.find((i) => i.name === 'Whole Branzino');
    expect(branzino?.status).toBe('out');
    expect(Date.now() - Date.parse(branzino!.outSince!)).toBeGreaterThan(72 * 3_600_000);
  });

  it('saves a corrected address and refuses a typo', async () => {
    await mockApi.saveVendor('main', 'Capital Meats', ' Orders@New-Butcher.example ');
    expect((await mockApi.listVendors('main')).find((v) => v.name === 'Capital Meats')?.email).toBe('orders@new-butcher.example');
    await expect(mockApi.saveVendor('main', 'Capital Meats', 'orders at butcher')).rejects.toThrow('does not look like an email');
  });

  it('records who emailed the vendor, and forgets it when the item changes', async () => {
    const id = 'main-whole-branzino';
    await mockApi.logVendorNote(id, 'Priya M.');
    let it = (await mockApi.listItems('main')).find((i) => i.id === id)!;
    expect(it.vendorNoteBy).toBe('Priya M.');
    expect(it.vendorNoteAt).toBeTruthy();
    await mockApi.markBack(id, 'Marco R.');
    it = (await mockApi.listItems('main')).find((i) => i.id === id)!;
    expect(it.vendorNoteAt).toBeUndefined();
    await expect(mockApi.logVendorNote(id, 'Priya M.')).rejects.toThrow('back on');
  });
});
