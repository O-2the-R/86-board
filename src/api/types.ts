import type { EightySixEvent, MenuItem, Restaurant, Session, Staff, StaffRole } from '../types';

export type ManageAction = 'create' | 'deactivate' | 'reactivate' | 'resetPassword' | 'remove';

export interface ManageStaffInput {
  action: ManageAction;
  username: string;
  displayName?: string;
  role?: StaffRole;
  restaurantId?: string;
  password?: string; // create only; empty means a temporary password
}

export interface ManageStaffResult {
  ok: boolean;
  username: string;
  temporaryPassword?: string;
  passwordSet?: boolean; // a chosen password was set for good
  active?: boolean;
  removed?: boolean;
}

export interface SeedResult {
  ok: boolean;
  restaurants: number;
  items: number;
  events: number;
  staff: number;
  demoPassword: string;
}

export type SignInResult = { status: 'done' } | { status: 'newPassword' };

// What the browser hands us when a phone signs up for alerts.
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string; // "iPhone", "Android", ... for the staff screen later
}

// The "data drawer". The screens only talk to this.
// Sample mode fills it from the browser (mock.ts); the real app from AWS (aws.ts).
export interface BoardApi {
  readonly mode: 'sample' | 'aws';

  // who is signed in
  currentSession(): Promise<Session | null>;
  signIn(username: string, password: string): Promise<SignInResult>;
  completeNewPassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  // false once a manager has switched this account off
  accessStillValid(username: string): Promise<boolean>;

  // the board
  listRestaurants(): Promise<Restaurant[]>;
  listItems(restaurantId: string): Promise<MenuItem[]>;
  markOut(itemId: string, note: string, by: string): Promise<void>;
  // a few portions left; count is what is left right now
  markLow(itemId: string, count: number, by: string): Promise<void>;
  // back to plenty, from low or from 86'd
  markBack(itemId: string, by: string): Promise<void>;
  listHistory(restaurantId: string, days: number): Promise<EightySixEvent[]>;

  // staff admin
  listStaff(): Promise<Staff[]>;
  manageStaff(input: ManageStaffInput): Promise<ManageStaffResult>;
  seedDemo(): Promise<SeedResult>;

  // phone alerts (web push). null public key means alerts are not available here.
  pushPublicKey(): Promise<string | null>;
  subscribePush(sub: PushSubscriptionInput): Promise<void>;
  unsubscribePush(endpoint: string): Promise<void>;
}
