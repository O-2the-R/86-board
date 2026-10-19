// The shapes of the data the app works with. The sample data today and the
// AWS database later both produce these same shapes.

export type Role = 'manager' | 'kitchen' | 'server' | 'host';

// Managers and kitchen can change the board. Servers and hosts can only look.
export const EDITOR_ROLES: readonly Role[] = ['manager', 'kitchen'];
export const canEditRole = (role: Role): boolean => EDITOR_ROLES.includes(role);

export type ItemStatus = 'available' | 'out';

export interface Restaurant {
  id: string;
  name: string;
  kind: string; // "Full service" or "Fast casual"
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  category: string;
  vendor?: string; // who supplies it; used later for the vendor notes
  status: ItemStatus;
  outSince?: string; // ISO time, set while the item is 86'd
  note?: string; // why it is out
  markedBy?: string; // who 86'd it
}

// One stretch of time an item was 86'd. This is the history.
export interface EightySixEvent {
  id: string;
  itemId: string;
  itemName: string;
  restaurantId: string;
  startedAt: string; // ISO time
  endedAt?: string; // ISO time; missing while the item is still out
  note?: string;
  markedBy: string;
  clearedBy?: string;
}
