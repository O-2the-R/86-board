// The shapes of the data the app works with. The sample data and the AWS
// database both produce these same shapes.

export type StaffRole = 'manager' | 'kitchen' | 'server' | 'host';
export type Role = 'owner' | StaffRole;

export const STAFF_ROLES: StaffRole[] = ['manager', 'kitchen', 'server', 'host'];

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  manager: 'Manager',
  kitchen: 'Kitchen',
  server: 'Server',
  host: 'Host',
};

// available: plenty. low: a few portions left, with the count. out: 86'd.
export type ItemStatus = 'available' | 'low' | 'out';

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
  sortOrder?: number;
  status: ItemStatus;
  outSince?: string; // ISO time, set while the item is 86'd
  note?: string; // why it is out
  markedBy?: string; // who 86'd it, or who marked it low
  lowCount?: number; // portions left, set while the item is running low
  lowSince?: string; // ISO time, set while the item is running low
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

export interface Staff {
  username: string;
  displayName: string;
  role: Role;
  restaurantId: string; // 'all' for the owner
  active: boolean;
}

// Who is signed in. Comes from the login (AWS) or the sample picker.
export interface Session {
  username: string;
  displayName: string;
  role: Role;
  restaurantId: string; // 'all' for the owner
}

export const isOwner = (s: Session): boolean => s.role === 'owner';
export const canEditBoard = (s: Session, restaurantId: string): boolean =>
  isOwner(s) || (s.restaurantId === restaurantId && (s.role === 'manager' || s.role === 'kitchen'));
export const canManageStaff = (s: Session): boolean => isOwner(s) || s.role === 'manager';
export const canSeeRestaurant = (s: Session, restaurantId: string): boolean => isOwner(s) || s.restaurantId === restaurantId;
