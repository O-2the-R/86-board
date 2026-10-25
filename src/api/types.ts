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

export interface RepairResult {
  ok: boolean;
  items: number;
  events: number;
  staff: number;
  openEvents: number;
}

export type SignInResult = { status: 'done' } | { status: 'newPassword' };

// What the browser hands us when a phone signs up for alerts.
export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string; // "iPhone", "Android", ... for the staff screen later
}

// The owner's n8n settings. One row; the key is made in the app.
export interface IntegrationSettings {
  webhookUrl: string; // where every 86 is sent; empty until the owner pastes it
  key: string; // sent with every note, and required on the report link
  reportUrl: string | null; // the morning-report address, null in the preview
  lastTestAt?: string;
  lastTestResult?: string;
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
  // `by` is the name shown in the sample mode; the real app stamps the name
  // on the server from the login and ignores it.
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
  // owner only: fills in what older rows are missing; safe to run any time
  repairData(): Promise<RepairResult>;

  // phone alerts (web push). null public key means alerts are not available here.
  pushPublicKey(): Promise<string | null>;
  subscribePush(sub: PushSubscriptionInput): Promise<void>;
  unsubscribePush(endpoint: string): Promise<void>;

  // automations (owner only)
  getIntegration(): Promise<IntegrationSettings>;
  saveIntegration(webhookUrl: string, key: string): Promise<IntegrationSettings>;
  testWebhook(): Promise<{ ok: boolean; summary: string }>;
}
