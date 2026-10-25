// The rules about who may create, switch off, or reset whom, as plain
// functions with no AWS in them. The handler asks these; the tests do too.
import { RESTAURANTS, groupFor, type SeedRole } from '../../../shared/sample-data';

export const ROLES: SeedRole[] = ['manager', 'kitchen', 'server', 'host'];
export const RESTAURANT_IDS = RESTAURANTS.map((r) => r.id);

export interface Actor {
  username: string;
  groups: string[];
  isOwner: boolean;
  managerOf: string[]; // restaurant ids this person manages
}

export interface PersonRecord {
  username: string;
  displayName: string;
  role: string;
  restaurantId: string;
  active: boolean;
}

export class Refused extends Error {}

export function actorFromIdentity(identity: { username?: string; groups?: string[] | null } | null | undefined): Actor {
  if (!identity || !identity.username) throw new Refused('Sign in first.');
  const groups = identity.groups ?? [];
  return {
    username: identity.username,
    groups,
    isOwner: groups.includes('owner'),
    managerOf: RESTAURANT_IDS.filter((r) => groups.includes(groupFor(r, 'manager'))),
  };
}

export const cleanUsername = (raw: string): string => raw.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');

// Board-4821! : easy to read out over the pass, still passes the password policy.
export const tempPassword = (random: () => number = Math.random): string => `Board-${1000 + Math.floor(random() * 9000)}!`;

export interface CreateInput {
  displayName: string;
  role: string;
  restaurantId: string;
  password: string; // '' means a temporary one
}

// Everything that must be true before a login is created. Throws Refused with
// the sentence the manager should read.
export function checkCreate(actor: Actor, input: CreateInput): { role: SeedRole; group: string; permanent: boolean } {
  const displayName = input.displayName.trim();
  const role = input.role as SeedRole;
  if (!displayName) throw new Refused('Name is required.');
  if (!ROLES.includes(role)) throw new Refused('Role must be manager, kitchen, server or host.');
  if (!RESTAURANT_IDS.includes(input.restaurantId)) throw new Refused('Pick a restaurant.');
  if (!actor.isOwner && !actor.managerOf.includes(input.restaurantId)) throw new Refused('You can only add staff at your own restaurant.');
  const chosen = input.password.trim();
  if (chosen && chosen.length < 8) throw new Refused('A password needs at least 8 characters, with a capital letter, a number and a symbol.');
  return { role, group: groupFor(input.restaurantId, role), permanent: Boolean(chosen) };
}

// May this actor change this existing person at all?
export function checkManage(actor: Actor, person: PersonRecord): void {
  if (person.role === 'owner' && !actor.isOwner) throw new Refused('Only the owner can change the owner account.');
  if (!actor.isOwner && !actor.managerOf.includes(person.restaurantId)) throw new Refused('You can only manage staff at your own restaurant.');
}

export function checkDeactivate(actor: Actor, person: PersonRecord): void {
  checkManage(actor, person);
  if (person.username === actor.username) throw new Refused('You cannot switch off your own account.');
}

// Only a login nobody ever used can be removed. Anyone who has signed in may
// be on the history, so their record stays and they get switched off.
export function checkRemove(actor: Actor, person: PersonRecord, cognitoStatus: string | undefined): void {
  checkManage(actor, person);
  if (person.username === actor.username) throw new Refused('You cannot remove your own account.');
  if (person.active) throw new Refused('Switch the login off first, then remove it.');
  if (cognitoStatus && cognitoStatus !== 'FORCE_CHANGE_PASSWORD') {
    throw new Refused(`${person.displayName} has signed in before, so their record stays. Leave them switched off.`);
  }
}
