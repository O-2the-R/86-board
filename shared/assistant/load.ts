// Reading the lists a restaurant loads for Ask. The owner picks a file; this
// checks every part of it before anything is stored and says in plain words
// what is wrong and where. What comes out holds only the fields the app
// knows (catalog.ts has the shape), so a stray field never reaches the AI.
import type { AllergenKey, AssistantCatalog, AssistantDoc, AssistantItem, ItemKind, Marks } from './catalog';
import { ALLERGEN_KEYS, isAllergenKey, norm } from './catalog';
import { leadFixed } from './prompt';

// Thrown with a sentence the owner can act on.
export class BadLists extends Error {}

export const LIMITS = {
  fileBytes: 250_000, // the file itself
  // What the AI reads before each question, built from the file, in bytes
  // (one per plain letter). It keeps a question far below 100,000 tokens,
  // where the AI's price per token goes up.
  leadBytes: 150_000,
  items: 600,
  docs: 30,
  docChars: 60_000,
  starters: 6,
} as const;

const KINDS: ItemKind[] = ['food', 'drink', 'wine'];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (n: number): string => n.toLocaleString('en-US');

export const byteLength = (text: string): number => new TextEncoder().encode(text).length;

// One line of text: trimmed, line breaks and runs of spaces turned into one space.
function line(v: unknown, max: number, what: string, required: boolean): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadLists(`${what} is missing.`);
    return '';
  }
  if (typeof v !== 'string') throw new BadLists(`${what} must be text.`);
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s && required) throw new BadLists(`${what} is missing.`);
  if (s.length > max) throw new BadLists(`${what} is too long (${num(s.length)} characters; the limit is ${num(max)}).`);
  return s;
}

function marksOf(v: unknown, what: string): Marks | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isRecord(v)) throw new BadLists(`${what} must look like { "egg": "Aioli is made with egg." }.`);
  const marks: Marks = {};
  for (const [key, reason] of Object.entries(v)) {
    if (!isAllergenKey(key)) throw new BadLists(`${what}: "${key}" is not an allergen key. The keys are: ${ALLERGEN_KEYS.join(', ')}.`);
    marks[key as AllergenKey] = line(reason, 240, `${what}, the reason for ${key}`, true);
  }
  return Object.keys(marks).length ? marks : undefined;
}

function itemOf(v: unknown, at: number): AssistantItem {
  if (!isRecord(v)) throw new BadLists(`Item ${at + 1} must look like { "name": …, "kind": …, "section": … }.`);
  const name = line(v.name, 80, `Item ${at + 1}: the name`, true);
  // these would break the way the AI and the app name an item to each other
  if (/[[\]|]/.test(name)) throw new BadLists(`${name}: a name cannot contain [ ] or |.`);
  if (!KINDS.includes(v.kind as ItemKind)) throw new BadLists(`${name}: "kind" must be food, drink or wine.`);
  const item: AssistantItem = { name, kind: v.kind as ItemKind, section: line(v.section, 40, `${name}: the section`, true) };
  const about = line(v.about, 500, `${name}: "about"`, false);
  if (about) item.about = about;
  if (v.menus !== undefined && v.menus !== null) {
    if (!Array.isArray(v.menus) || v.menus.length > 8) throw new BadLists(`${name}: "menus" must be a short list like ["dinner", "lunch"].`);
    const menus = v.menus.map((m) => line(m, 24, `${name}: a menu name`, true));
    if (menus.length) item.menus = menus;
  }
  if (v.prices !== undefined && v.prices !== null) {
    if (!isRecord(v.prices)) throw new BadLists(`${name}: "prices" must look like { "glass": 14, "bottle": 54 }.`);
    const prices: NonNullable<AssistantItem['prices']> = {};
    for (const unit of ['glass', 'carafe', 'bottle'] as const) {
      const p = v.prices[unit];
      if (p === undefined || p === null) continue;
      if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0 || p > 100_000) throw new BadLists(`${name}: the ${unit} price must be a number, like 14.`);
      prices[unit] = p;
    }
    if (Object.keys(prices).length) item.prices = prices;
  }
  const avoid = marksOf(v.avoid, `${name}: "avoid"`);
  if (avoid) item.avoid = avoid;
  const ask = marksOf(v.ask, `${name}: "ask"`);
  if (ask) item.ask = ask;
  if (v.offSheet !== undefined && v.offSheet !== null) {
    if (typeof v.offSheet !== 'boolean') throw new BadLists(`${name}: "offSheet" must be true or false.`);
    if (v.offSheet) item.offSheet = true;
  }
  const board = line(v.board, 80, `${name}: "board"`, false);
  if (board) item.board = board;
  return item;
}

function docOf(v: unknown, at: number): AssistantDoc {
  if (!isRecord(v)) throw new BadLists(`House note ${at + 1} must look like { "title": …, "text": … }.`);
  const title = line(v.title, 80, `House note ${at + 1}: the title`, true);
  if (typeof v.text !== 'string' || !v.text.trim()) throw new BadLists(`${title}: the text is missing.`);
  const text = v.text.replace(/\r\n?/g, '\n').trim();
  if (text.length > LIMITS.docChars) throw new BadLists(`${title} is too long (${num(text.length)} characters; the limit is ${num(LIMITS.docChars)}).`);
  const doc: AssistantDoc = { title, text };
  const asOf = line(v.asOf, 40, `${title}: "asOf"`, false);
  if (asOf) doc.asOf = asOf;
  return doc;
}

// The file as text -> whatever it holds. Says so when it is not JSON.
export function parseLists(text: string): unknown {
  if (byteLength(text) > LIMITS.fileBytes) throw new BadLists(`That file is too big (${num(byteLength(text))} bytes; the limit is ${num(LIMITS.fileBytes)}).`);
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BadLists('That file is not a lists file the app can read. It must be JSON, the format the sample file is in.');
  }
}

// Checks everything and returns clean lists for one restaurant. `today` is
// the fallback for "asOf" ("Loaded Nov 20, 2026").
export function cleanCatalog(restaurantId: string, raw: unknown, today: string): AssistantCatalog {
  if (!isRecord(raw)) throw new BadLists('The file must hold one set of lists: { "name": …, "venue": …, "items": [ … ] }.');
  if (!Array.isArray(raw.items) || raw.items.length === 0) throw new BadLists('The file has no "items": the dishes, drinks and wines.');
  if (raw.items.length > LIMITS.items) throw new BadLists(`The file has ${num(raw.items.length)} items; the limit is ${num(LIMITS.items)}.`);
  const items = raw.items.map(itemOf);
  const seen = new Map<string, string>();
  for (const item of items) {
    const key = norm(item.name);
    const twin = seen.get(key);
    if (twin !== undefined) throw new BadLists(`Two items read as the same name: "${twin}" and "${item.name}". The chat could confuse them.`);
    seen.set(key, item.name);
  }

  const rawDocs = raw.docs ?? [];
  if (!Array.isArray(rawDocs) || rawDocs.length > LIMITS.docs) throw new BadLists(`"docs" must be a list of at most ${LIMITS.docs} house notes.`);
  const rawStarters = raw.starters ?? [];
  if (!Array.isArray(rawStarters) || rawStarters.length > LIMITS.starters) throw new BadLists(`"starters" must be a list of at most ${LIMITS.starters} first questions.`);

  const catalog: AssistantCatalog = {
    restaurantId,
    name: line(raw.name, 24, 'The name', false) || 'Ask',
    venue: line(raw.venue, 200, '"venue" (one line saying what the restaurant is)', true),
    asOf: line(raw.asOf, 80, '"asOf"', false) || `Loaded ${today}`,
    items,
    docs: rawDocs.map(docOf),
    starters: rawStarters.map((s, i) => line(s, 90, `First question ${i + 1}`, true)),
  };

  const size = byteLength(leadFixed(catalog));
  if (size > LIMITS.leadBytes) {
    throw new BadLists(`These lists are too long for the AI to read before every question (about ${num(size)} characters; the limit is ${num(LIMITS.leadBytes)}). Shorten the house notes.`);
  }
  return catalog;
}

// The numbers the owner sees after loading.
export const countsOf = (catalog: AssistantCatalog): { items: number; notes: number } => ({ items: catalog.items.length, notes: catalog.docs.length });
