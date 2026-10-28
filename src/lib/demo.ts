// The public demo. Anyone with the link (…/?demo) or the "Try the demo"
// button gets a made-up login and the three sample restaurants, all inside
// their own browser. In demo mode the data drawer is the sample one
// (src/api/index.ts), so nothing a visitor does reaches the real board,
// sends an alert, or creates a real account.
import type { StaffRole } from '../types';
import type { RandomInt } from '../../shared/logins';

// Remembered for this tab only, so a real staff member who peeked at the
// demo opens the real app next time.
const FLAG = 'eightysix.demo';

function urlAsksForDemo(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
}

function flagSet(): boolean {
  try {
    return sessionStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

export function inDemo(): boolean {
  return urlAsksForDemo() || flagSet();
}

// From the real sign-in page: reload into the demo.
export function openDemo(): void {
  try {
    sessionStorage.setItem(FLAG, '1');
  } catch {
    // the ?demo in the address carries it instead
  }
  window.location.assign(`${window.location.pathname}?demo`);
}

// Back to the real sign-in page.
export function closeDemo(): void {
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    // nothing stored
  }
  window.location.assign(window.location.pathname);
}

export type DemoRole = Exclude<StaffRole, 'host'> | 'owner';

export interface DemoRoleInfo {
  role: DemoRole;
  label: string;
  line: string;
  restaurantId: string; // 'all' for the owner
}

export const DEMO_ROLES: DemoRoleInfo[] = [
  { role: 'kitchen', label: 'Kitchen', line: '86 an item, mark it running low, put it back on.', restaurantId: 'main' },
  { role: 'server', label: 'Server', line: 'See what is out the moment it happens. Look, don’t touch.', restaurantId: 'main' },
  { role: 'manager', label: 'Manager', line: 'Run the board and add staff with the login generator.', restaurantId: 'main' },
  { role: 'owner', label: 'Owner', line: 'Every restaurant, every screen.', restaurantId: 'all' },
];

// guest.kitchen.4821
export const demoUsername = (role: DemoRole, randomInt: RandomInt): string => `guest.${role}.${1000 + randomInt(9000)}`;

// Every demo login starts with "guest.", so either sign-in page can tell a
// demo login from a real one.
export const isGuestUsername = (username: string): boolean => /^guest\./.test(username.trim().toLowerCase());
