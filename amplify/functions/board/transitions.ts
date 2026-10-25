// What happens to an item when someone taps 86 it, Running low, or Back on.
// Plain functions: given the item as it is, the action, who is doing it and
// the time, they say exactly what to write. The handler does the writing.
import { editorGroupsFor } from '../../../shared/sample-data';

export type Status = 'available' | 'low' | 'out';

export interface ItemState {
  id: string;
  restaurantId: string;
  name: string;
  status: Status;
  outSince?: string | null;
  note?: string | null;
  markedBy?: string | null;
  lowCount?: number | null;
  lowSince?: string | null;
  openEventId?: string | null;
}

export type Action = { kind: 'out'; note: string } | { kind: 'low'; count: number } | { kind: 'back' };

export interface ItemUpdate {
  status: Status;
  outSince: string | null;
  note: string | null;
  markedBy: string | null;
  lowCount: number | null;
  lowSince: string | null;
  openEventId: string | null;
}

export type Plan =
  | { kind: 'noop'; reason: string }
  | {
      kind: 'write';
      update: ItemUpdate;
      openEvent: boolean; // create a new history entry (its id goes into update.openEventId)
      closeEventId: string | null; // end this history entry; null means none known
      closeNeeded: boolean; // the item was out, so an open entry must be ended even if its id is unknown
    };

export class Refused extends Error {}

// Owner anywhere; manager or kitchen at the item's own restaurant.
export function canEditItem(groups: string[], restaurantId: string): boolean {
  if (groups.includes('owner')) return true;
  return editorGroupsFor(restaurantId).some((g) => groups.includes(g));
}

export function parseAction(args: { action: string; note?: string | null; count?: number | null }): Action {
  if (args.action === 'out') return { kind: 'out', note: (args.note ?? '').trim().slice(0, 80) };
  if (args.action === 'low') {
    const count = Math.round(Number(args.count));
    if (!Number.isFinite(count) || count < 1) throw new Refused('How many are left? Pick a number of 1 or more.');
    return { kind: 'low', count: Math.min(count, 999) };
  }
  if (args.action === 'back') return { kind: 'back' };
  throw new Refused(`Unknown action ${args.action}. Use out, low or back.`);
}

const cleared = (status: Status): ItemUpdate => ({ status, outSince: null, note: null, markedBy: null, lowCount: null, lowSince: null, openEventId: null });

export function plan(item: ItemState, action: Action, by: string, now: string): Plan {
  if (action.kind === 'out') {
    if (item.status === 'out') return { kind: 'noop', reason: `${item.name} is already 86'd.` };
    return {
      kind: 'write',
      update: { ...cleared('out'), outSince: now, note: action.note || null, markedBy: by },
      openEvent: true,
      closeEventId: null,
      closeNeeded: false,
    };
  }
  if (action.kind === 'low') {
    const wasLow = item.status === 'low';
    return {
      kind: 'write',
      update: { ...cleared('low'), lowCount: action.count, lowSince: wasLow && item.lowSince ? item.lowSince : now, markedBy: by },
      openEvent: false,
      closeEventId: item.status === 'out' ? (item.openEventId ?? null) : null,
      closeNeeded: item.status === 'out',
    };
  }
  // back
  if (item.status === 'available') return { kind: 'noop', reason: `${item.name} is already on.` };
  return {
    kind: 'write',
    update: cleared('available'),
    openEvent: false,
    closeEventId: item.status === 'out' ? (item.openEventId ?? null) : null,
    closeNeeded: item.status === 'out',
  };
}
