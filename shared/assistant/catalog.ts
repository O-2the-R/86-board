// "Ask" is the app's second function: a chat for the floor that knows one
// restaurant's food, drinks and house notes, and what is 86'd right now.
// This file is the shape of what a restaurant loads for it. The lists
// themselves are data, never code: the sample restaurants' lists live in
// sample.ts, a real restaurant's lists are loaded privately.

// The allergens staff can check for. `covers` is what the AI is told a key means.
export const ALLERGENS = [
  { key: 'gluten', label: 'Gluten / wheat', covers: 'gluten, wheat, celiac' },
  { key: 'dairy', label: 'Dairy', covers: 'milk, lactose, butter, cream, cheese' },
  { key: 'egg', label: 'Egg', covers: 'egg' },
  { key: 'fish', label: 'Fish', covers: 'fish with fins, not shellfish' },
  { key: 'shellfish', label: 'Shellfish', covers: 'shrimp, crab, lobster, clams, squid, any shellfish' },
  { key: 'nuts', label: 'Tree nuts', covers: 'tree nuts such as almond, pistachio, walnut, hazelnut' },
  { key: 'peanut', label: 'Peanuts', covers: 'peanuts' },
  { key: 'soy', label: 'Soy', covers: 'soy' },
  { key: 'sesame', label: 'Sesame', covers: 'sesame' },
  { key: 'allium', label: 'Garlic / onion', covers: 'garlic, onion, shallot, chive' },
  { key: 'nightshade', label: 'Nightshades', covers: 'tomato, potato, eggplant, peppers' },
  { key: 'capsicum', label: 'Peppers / chili', covers: 'peppers and chili' },
  { key: 'citrus', label: 'Citrus', covers: 'lemon, lime, orange, grapefruit' },
  { key: 'pork', label: 'Pork', covers: 'pork' },
  { key: 'mushroom', label: 'Mushroom', covers: 'mushroom, truffle' },
  { key: 'alcohol', label: 'Alcohol', covers: 'alcohol' },
  { key: 'legumes', label: 'Legumes', covers: 'beans, peas, lentils' },
  { key: 'coffee', label: 'Coffee', covers: 'coffee' },
  { key: 'cocoa', label: 'Chocolate', covers: 'chocolate, cocoa' },
  { key: 'fig', label: 'Fig', covers: 'fig' },
] as const;

export type AllergenKey = (typeof ALLERGENS)[number]['key'];
export const ALLERGEN_KEYS: AllergenKey[] = ALLERGENS.map((a) => a.key);
export const isAllergenKey = (k: string): k is AllergenKey => (ALLERGEN_KEYS as string[]).includes(k);
export const allergenLabel = (k: AllergenKey): string => ALLERGENS.find((a) => a.key === k)?.label ?? k;
// the order of the list above, whatever order they were picked in
export const inOrder = (keys: Iterable<AllergenKey>): AllergenKey[] => {
  const set = new Set(keys);
  return ALLERGEN_KEYS.filter((k) => set.has(k));
};

export type ItemKind = 'food' | 'drink' | 'wine';

// allergen -> the reason, in plain words ("Fried in a wheat batter.")
export type Marks = Partial<Record<AllergenKey, string>>;

export interface AssistantItem {
  name: string;
  kind: ItemKind;
  section: string; // "Starters", "Cocktails", "Red"
  about?: string; // what is in it, or the wine's style
  menus?: string[]; // "dinner", "lunch", ... for food on some menus only
  prices?: { glass?: number; carafe?: number; bottle?: number }; // wine, as printed on the list
  avoid?: Marks; // the guest must not have it
  ask?: Marks; // the sources are unclear: ask the chef or the bar first
  offSheet?: boolean; // not on the restaurant's allergy sheet, so every other allergen is "Ask first"
  board?: string; // its name on the 86 board, when that differs from `name`
}

// A piece of the restaurant's own training material: the bar manual, the steps of service.
export interface AssistantDoc {
  title: string;
  asOf?: string; // "Fall 2026"; shown to staff and given to the AI, so an old note reads as old
  text: string;
}

export interface AssistantCatalog {
  restaurantId: string;
  name: string; // what staff call the assistant; also the tab's title
  venue: string; // one line for the AI: "Main Street, a full-service Italian-American restaurant"
  asOf: string; // when the lists were loaded, in words; shown under the greeting
  items: AssistantItem[];
  docs: AssistantDoc[];
  starters: string[]; // first questions offered on the opening screen
}

// "a", "a and b", "a, b and c"
export function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

// One spelling for matching names: lower case, no accents, "&" read as "and".
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// What the 86 board says right now, by the name an item has on the board.
export interface BoardNow {
  out: Set<string>; // norm(name) of everything 86'd
  low: Map<string, number>; // norm(name) -> portions left
}

export const NOTHING_OUT: BoardNow = { out: new Set(), low: new Map() };

export function boardNow(items: { name: string; status: string; lowCount?: number }[]): BoardNow {
  const now: BoardNow = { out: new Set(), low: new Map() };
  for (const i of items) {
    if (i.status === 'out') now.out.add(norm(i.name));
    else if (i.status === 'low') now.low.set(norm(i.name), i.lowCount ?? 0);
  }
  return now;
}

const boardKey = (item: AssistantItem): string => norm(item.board ?? item.name);
export const isOut = (item: AssistantItem, now: BoardNow): boolean => now.out.has(boardKey(item));
export const lowCount = (item: AssistantItem, now: BoardNow): number | undefined => now.low.get(boardKey(item));
