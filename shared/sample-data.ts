// Sample data shared by the in-browser preview (src/api/mock.ts) and the
// one-time "load demo data" step in the backend (amplify/functions/staff-admin).
// Three restaurants, their menus, a week of 86 history, and 60 staff.

export type SeedRole = 'manager' | 'kitchen' | 'server' | 'host';

export interface SeedRestaurant {
  id: string;
  name: string;
  kind: string;
}

export const RESTAURANTS: SeedRestaurant[] = [
  { id: 'main', name: 'Main Street', kind: 'Full service' },
  { id: 'water', name: 'Waterfront', kind: 'Full service' },
  { id: 'counter', name: 'The Counter', kind: 'Fast casual' },
];

export const RESTAURANT_IDS = RESTAURANTS.map((r) => r.id);

// [category, name, vendor?]
export type MenuRow = [category: string, name: string, vendor?: string];

export const MENUS: Record<string, MenuRow[]> = {
  main: [
    ['Starters', 'Burrata & Peach', 'Blue Ridge Produce'],
    ['Starters', 'Tuna Crudo', 'Chesapeake Seafood Co.'],
    ['Starters', 'Crispy Calamari', 'Chesapeake Seafood Co.'],
    ['Starters', 'Caesar', 'Blue Ridge Produce'],
    ['Pasta', 'Tagliatelle Bolognese', 'Capital Meats'],
    ['Pasta', 'Cacio e Pepe'],
    ['Pasta', 'Lobster Ravioli', 'Chesapeake Seafood Co.'],
    ['Mains', 'Pan-Roasted Halibut', 'Chesapeake Seafood Co.'],
    ['Mains', 'Braised Short Rib', 'Capital Meats'],
    ['Mains', 'Whole Branzino', 'Chesapeake Seafood Co.'],
    ['Mains', 'Ribeye 16 oz', 'Capital Meats'],
    ['Mains', 'Roast Chicken', 'Capital Meats'],
    ['Desserts', 'Tiramisu', 'Metro Bakery'],
    ['Desserts', 'Olive Oil Cake', 'Metro Bakery'],
    ['Bar', 'Espresso Martini'],
    ['Bar', 'Pinot Noir (glass)', 'Potomac Wine & Spirits'],
    ['Bar', 'Negroni'],
  ],
  water: [
    ['Raw Bar', 'Oysters, East Coast', 'Chesapeake Seafood Co.'],
    ['Raw Bar', 'Oysters, West Coast', 'Chesapeake Seafood Co.'],
    ['Raw Bar', 'Shrimp Cocktail', 'Chesapeake Seafood Co.'],
    ['Starters', 'Crab Cake', 'Chesapeake Seafood Co.'],
    ['Starters', 'Clam Chowder', 'Chesapeake Seafood Co.'],
    ['Mains', 'Lobster Roll', 'Chesapeake Seafood Co.'],
    ['Mains', 'Grilled Swordfish', 'Chesapeake Seafood Co.'],
    ['Mains', 'Seared Scallops', 'Chesapeake Seafood Co.'],
    ['Mains', 'Steak Frites', 'Capital Meats'],
    ['Mains', 'Fish & Chips', 'Chesapeake Seafood Co.'],
    ['Sides', 'Truffle Fries', 'Blue Ridge Produce'],
    ['Sides', 'Grilled Asparagus', 'Blue Ridge Produce'],
    ['Bar', 'Sancerre (glass)', 'Potomac Wine & Spirits'],
    ['Bar', 'Aperol Spritz', 'Potomac Wine & Spirits'],
  ],
  counter: [
    ['Bowls', 'Chicken Shawarma Bowl', 'Capital Meats'],
    ['Bowls', 'Falafel Bowl', 'Blue Ridge Produce'],
    ['Bowls', 'Steak Bowl', 'Capital Meats'],
    ['Sandwiches', 'Chicken Pesto', 'Metro Bakery'],
    ['Sandwiches', 'Italian Sub', 'Metro Bakery'],
    ['Sandwiches', 'Veggie Wrap', 'Blue Ridge Produce'],
    ['Sides', 'Fries'],
    ['Sides', 'Side Salad', 'Blue Ridge Produce'],
    ['Sides', 'Hummus & Pita', 'Metro Bakery'],
    ['Drinks', 'Lemonade'],
    ['Drinks', 'Cold Brew'],
    ['Drinks', 'Sparkling Water'],
  ],
};

// Items that are out right now when the sample data is first created.
export interface OpenSeed {
  rest: string;
  item: string;
  hoursAgo: number;
  note: string;
  by: string;
}

// Past 86s, already back on.
export interface ClosedSeed extends OpenSeed {
  hours: number; // how long it was out
  clearedBy: string;
}

export const OPEN_SEEDS: OpenSeed[] = [
  { rest: 'main', item: 'Pan-Roasted Halibut', hoursAgo: 3.1, note: 'Chesapeake shorted the order, back Tuesday', by: 'Marco R.' },
  { rest: 'main', item: 'Burrata & Peach', hoursAgo: 0.7, note: 'Sold out', by: 'Marco R.' },
  { rest: 'water', item: 'Oysters, West Coast', hoursAgo: 27, note: "Didn't come in", by: 'Dev P.' },
  { rest: 'counter', item: 'Cold Brew', hoursAgo: 2.2, note: 'Machine down', by: 'Alex J.' },
];

// Items that are running low right now when the sample data is first created.
export interface LowSeed {
  rest: string;
  item: string;
  count: number; // portions left
  minutesAgo: number;
  by: string;
}

export const LOW_SEEDS: LowSeed[] = [
  { rest: 'main', item: 'Ribeye 16 oz', count: 4, minutesAgo: 25, by: 'Marco R.' },
  { rest: 'main', item: 'Olive Oil Cake', count: 2, minutesAgo: 70, by: 'Luis H.' },
  { rest: 'water', item: 'Crab Cake', count: 6, minutesAgo: 40, by: 'Yusuf E.' },
  { rest: 'counter', item: 'Steak Bowl', count: 3, minutesAgo: 15, by: 'Diego M.' },
];

export const CLOSED_SEEDS: ClosedSeed[] = [
  { rest: 'main', item: 'Braised Short Rib', hoursAgo: 50, hours: 3.5, note: 'Sold out', by: 'Marco R.', clearedBy: 'Priya M.' },
  { rest: 'main', item: 'Tiramisu', hoursAgo: 74, hours: 2, note: 'Sold out', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Burrata & Peach', hoursAgo: 100, hours: 1.5, note: 'Sold out', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Pan-Roasted Halibut', hoursAgo: 150, hours: 4.2, note: 'Vendor short', by: 'Marco R.', clearedBy: 'Marco R.' },
  { rest: 'main', item: 'Lobster Ravioli', hoursAgo: 220, hours: 26, note: "Didn't come in", by: 'Marco R.', clearedBy: 'Priya M.' },
  { rest: 'water', item: 'Lobster Roll', hoursAgo: 26, hours: 2.5, note: 'Sold out', by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'water', item: 'Oysters, West Coast', hoursAgo: 120, hours: 30, note: "Didn't come in", by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'water', item: 'Seared Scallops', hoursAgo: 170, hours: 3, note: 'Quality, pulled', by: 'Dev P.', clearedBy: 'Dev P.' },
  { rest: 'counter', item: 'Cold Brew', hoursAgo: 96, hours: 5, note: 'Machine down', by: 'Alex J.', clearedBy: 'Alex J.' },
  { rest: 'counter', item: 'Falafel Bowl', hoursAgo: 30, hours: 1, note: 'Sold out', by: 'Alex J.', clearedBy: 'Alex J.' },
];

export interface SeedStaff {
  username: string;
  displayName: string;
  role: SeedRole;
  restaurantId: string;
}

// 20 people per restaurant: 3 managers, 7 kitchen, 7 servers, 3 hosts.
const ROSTER: Record<string, Record<SeedRole, string[]>> = {
  main: {
    manager: ['Priya M.', 'Daniel O.', 'Renata F.'],
    kitchen: ['Marco R.', 'Luis H.', 'Tomas B.', 'Aisha K.', 'Jun P.', 'Grace N.', 'Elena V.'],
    server: ['Sam T.', 'Nadia S.', 'Chris W.', 'Maya L.', 'Jordan C.', 'Bea R.', 'Kofi A.'],
    host: ['Lena K.', 'Theo G.', 'Sofia D.'],
  },
  water: {
    manager: ['Dev P.', 'Hannah B.', 'Marcus J.'],
    kitchen: ['Yusuf E.', 'Carla M.', 'Ben S.', 'Ines R.', 'Paulo C.', 'Mei W.', 'Andre L.'],
    server: ['Zoe F.', 'Victor N.', 'Leah T.', 'Rafael G.', 'Amara O.', 'Nick D.', 'Hana Y.'],
    host: ['Clara B.', 'Owen H.', 'Rosa P.'],
  },
  counter: {
    manager: ['Alex J.', 'Fatima R.', 'Sean K.'],
    kitchen: ['Diego M.', 'Tasha W.', 'Ravi S.', 'Lily C.', 'Mateo A.', 'Nora B.', 'Kenji T.'],
    server: ['Jamal H.', 'Erin M.', 'Pablo V.', 'Sara L.', 'Tyler R.', 'Ava G.', 'Ivan P.'],
    host: ['Mia S.', 'Noah E.', 'Layla F.'],
  },
};

// "Marco R." -> "marco.r"
export const usernameFor = (displayName: string): string =>
  displayName
    .toLowerCase()
    .replace(/\./g, '')
    .trim()
    .split(/\s+/)
    .join('.');

export const STAFF: SeedStaff[] = Object.entries(ROSTER).flatMap(([restaurantId, byRole]) =>
  (Object.keys(byRole) as SeedRole[]).flatMap((role) =>
    byRole[role].map((displayName) => ({ username: usernameFor(displayName), displayName, role, restaurantId })),
  ),
);

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const itemIdFor = (restaurantId: string, name: string): string => `${restaurantId}-${slug(name)}`;

// Cognito groups: "owner", plus one per restaurant and role ("main-kitchen").
export const groupFor = (restaurantId: string, role: SeedRole): string => `${restaurantId}-${role}`;

export const EDITOR_ROLES: SeedRole[] = ['manager', 'kitchen'];

// Groups allowed to change a restaurant's board.
export const editorGroupsFor = (restaurantId: string): string[] => EDITOR_ROLES.map((role) => groupFor(restaurantId, role));

export const ALL_ROLES: SeedRole[] = ['manager', 'kitchen', 'server', 'host'];

// Groups allowed to see a restaurant's board, history and staff list: everyone
// who works there. The owner is covered by the owner group itself.
export const readerGroupsFor = (restaurantId: string): string[] => ALL_ROLES.map((role) => groupFor(restaurantId, role));

// Owner rows (restaurantId 'all') are the owner's alone.
export const readersFor = (restaurantId: string): string[] => (restaurantId === 'all' ? ['owner'] : readerGroupsFor(restaurantId));
