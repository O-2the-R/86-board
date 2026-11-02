// The live board. The server pushes every change to an item the moment the
// board function saves it; these helpers fold those changes into the list on
// screen and decide how often to double-check with a full load.
import type { MenuItem } from '../types';

// One change pushed by the server.
export type ItemChange = { kind: 'upsert'; item: MenuItem } | { kind: 'remove'; id: string };

// Where the live connection stands.
//   live        connected; changes arrive as they happen
//   connecting  starting up, or reconnecting after the network blipped
//   down        not connected; the board asks every 5 seconds instead
//   none        this data drawer has no live feed (the sample mode and demo)
export type LinkState = 'live' | 'connecting' | 'down' | 'none';

// With a live connection, a full load every 30 seconds is only a safety net
// (and the check that the account is still switched on). Without one, the
// board asks every 5 seconds, as it always has.
export const HEARTBEAT_MS = 30_000;
export const POLL_MS = 5_000;

export const checkEveryMs = (link: LinkState): number => (link === 'live' ? HEARTBEAT_MS : POLL_MS);

const bySortOrder = (a: MenuItem, b: MenuItem) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);

const newer = (a: MenuItem, b: MenuItem): boolean => Boolean(a.updatedAt && b.updatedAt && a.updatedAt > b.updatedAt);

// Folds one pushed change into the board. Changes for another restaurant are
// ignored, and an older copy never replaces a newer one.
export function applyChange(items: MenuItem[], change: ItemChange, restaurantId: string): MenuItem[] {
  if (change.kind === 'remove') return items.some((i) => i.id === change.id) ? items.filter((i) => i.id !== change.id) : items;
  const item = change.item;
  if (item.restaurantId !== restaurantId) return items;
  const at = items.findIndex((i) => i.id === item.id);
  if (at === -1) return [...items, item].sort(bySortOrder);
  if (newer(items[at], item)) return items;
  const next = items.slice();
  next[at] = item;
  return next;
}

// A full load replaces the board, except where a pushed change arrived while
// the load was on its way and is newer than what the load brought back.
export function mergeLoaded(current: MenuItem[], loaded: MenuItem[]): MenuItem[] {
  const now = new Map(current.map((i) => [i.id, i]));
  return loaded.map((l) => {
    const c = now.get(l.id);
    return c && newer(c, l) ? c : l;
  });
}

// The live feed vouches for the board. `seen` holds, for each item, the
// newest version the feed has delivered (starting from a load made while
// live). A later load that brings back a version the feed never delivered,
// saved well before the load began, means the feed cannot be trusted: the
// board goes back to asking every 5 seconds. A change saved in the last few
// seconds may still be on its way; if the feed never brings it, the next load
// 30 seconds later catches it.
export const FEED_GRACE_MS = 10_000; // generous, so a phone clock a few seconds off never cries wolf

export type FeedSeen = Map<string, string>; // item id -> updatedAt

export const seenFrom = (items: MenuItem[]): FeedSeen => new Map(items.flatMap((i) => (i.updatedAt ? [[i.id, i.updatedAt] as const] : [])));

// Records what the feed just delivered.
export function noteDelivered(seen: FeedSeen, change: ItemChange): void {
  if (change.kind === 'remove') {
    seen.delete(change.id);
    return;
  }
  const at = change.item.updatedAt;
  if (at && at > (seen.get(change.item.id) ?? '')) seen.set(change.item.id, at);
}

export function missedByFeed(seen: FeedSeen, loaded: MenuItem[], loadStartedAt: number): boolean {
  return loaded.some((l) => {
    if (!l.updatedAt || Date.parse(l.updatedAt) > loadStartedAt - FEED_GRACE_MS) return false;
    return l.updatedAt > (seen.get(l.id) ?? '');
  });
}

// Amplify's connection states, in three words.
export function linkStateOf(connectionState: string): Exclude<LinkState, 'none'> {
  if (connectionState === 'Connected') return 'live';
  if (connectionState === 'Connecting' || connectionState === 'ConnectedPendingKeepAlive' || connectionState === 'ConnectedPendingNetwork') return 'connecting';
  return 'down';
}
