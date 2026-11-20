// Reading what comes back from the AI. The AI writes the chat; the app reads
// two things out of it and trusts nothing else: the allergies it heard
// (line 1) and the list items it named (in [[double brackets]]). The labels
// printed next to those items come from check.ts, not from the AI.
import type { AllergenKey, AssistantItem } from './catalog';
import { isAllergenKey, norm } from './catalog';

// Everyday words the AI may put on line 1 in place of a key.
const ALIAS: Record<string, AllergenKey> = {
  'tree nuts': 'nuts',
  'tree nut': 'nuts',
  nut: 'nuts',
  peanuts: 'peanut',
  garlic: 'allium',
  onion: 'allium',
  chocolate: 'cocoa',
  peppers: 'capsicum',
  pepper: 'capsicum',
  chili: 'capsicum',
  wheat: 'gluten',
  celiac: 'gluten',
  milk: 'dairy',
  lactose: 'dairy',
  nightshades: 'nightshade',
  tomato: 'nightshade',
  eggs: 'egg',
  beans: 'legumes',
  mushrooms: 'mushroom',
  figs: 'fig',
};

export type Parsed = { wait: true } | { wait: false; keys: AllergenKey[]; other: string[]; body: string };

// Line 1 is "ALLERGIES: <keys> | OTHER: <words>". `wait` while that line is still arriving.
export function parseReply(raw: string, done: boolean): Parsed {
  const nl = raw.indexOf('\n');
  const first = nl < 0 ? raw : raw.slice(0, nl);
  if (!/^\s*ALLERGIES\s*:/i.test(first)) {
    if (nl < 0 && !done && /^\s*A[LERGIS: ]*$/i.test(first)) return { wait: true };
    return { wait: false, keys: [], other: [], body: raw };
  }
  if (nl < 0 && !done) return { wait: true };
  const m = first.match(/^\s*ALLERGIES\s*:\s*(.*?)\s*(?:\|\s*OTHER\s*:\s*(.*))?$/i);
  const list = (s: string | undefined): string[] =>
    String(s ?? '')
      .split(',')
      .map((x) => x.trim().toLowerCase().replace(/[.\s]+$/, ''))
      .filter((x) => x !== '' && x !== 'none');
  const named = list(m?.[1]);
  const keys = [...new Set(named.map((k) => ALIAS[k] ?? k).filter(isAllergenKey))];
  const stray = named.filter((k) => !isAllergenKey(ALIAS[k] ?? k)); // an allergy with no key: the app has no data for it
  return { wait: false, keys, other: list(m?.[2]).concat(stray), body: nl < 0 ? '' : raw.slice(nl + 1).replace(/^\s+/, '') };
}

// Finds the list item the AI meant by a bracketed name: the exact name first,
// then most of the words, and only when one item clearly fits.
export function makeResolver(items: AssistantItem[]): (name: string) => AssistantItem | null {
  const rows = items.map((item) => {
    const key = norm(item.name);
    return { item, key, toks: key.split(' ') };
  });
  const byKey = new Map(rows.map((r) => [r.key, r.item]));
  return (name) => {
    const k = norm(name);
    const exact = byKey.get(k);
    if (exact) return exact;
    const toks = new Set(k.split(' '));
    let best: AssistantItem | null = null;
    let bestScore = 0;
    let tie = false;
    for (const r of rows) {
      const hit = r.toks.filter((t) => toks.has(t)).length;
      if (hit / toks.size < 0.6) continue; // most of the words written must belong to the item
      const score = hit / r.toks.length; // and most of the item's name must be there
      if (score > bestScore) {
        best = r.item;
        bestScore = score;
        tie = false;
      } else if (score === bestScore && score > 0) tie = true;
    }
    return bestScore >= 0.6 && !tie ? best : null;
  };
}

// A reply as paragraphs of plain text and named items, plus every item found.
export type Seg = string | AssistantItem;
export interface Body {
  paras: Seg[][];
  found: AssistantItem[];
}

export function splitBody(body: string, done: boolean, resolve: (name: string) => AssistantItem | null): Body {
  let text = body.replace(/\*\*/g, '');
  if (!done) {
    // half a bracket is still arriving: hold it back
    const open = text.lastIndexOf('[[');
    if (open >= 0 && text.indexOf(']]', open) < 0) text = text.slice(0, open);
  }
  const found: AssistantItem[] = [];
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const segs: Seg[] = [];
      let last = 0;
      for (const m of p.matchAll(/\[\[(.+?)\]\]/g)) {
        const at = m.index ?? 0;
        if (at > last) segs.push(p.slice(last, at));
        const item = resolve(m[1]);
        if (item) {
          segs.push(item);
          if (!found.includes(item)) found.push(item);
        } else segs.push(m[1]); // not on the lists: plain words, no label
        last = at + m[0].length;
      }
      if (last < p.length) segs.push(p.slice(last));
      return segs;
    });
  return { paras, found };
}

// The app never calls anything safe. This spots a reply that did, so the app
// can say so under it. "Not the same as safe" is the app's own wording and is fine.
const CLAIM = /\b(safe|allergen[- ]free|free of|free from|does(?:n't| not) contain|contains? no)\b/i;
export const claimsSafe = (body: string): boolean => CLAIM.test(body.replace(/\b(not|never|isn't|is not|no longer)( \w+){0,4} safe\b/gi, ''));

// Allergies named in the server's own message: a backup for the AI's line 1,
// so the labels are right even before the AI answers.
const WORDS: Record<AllergenKey, RegExp> = {
  gluten: /gluten|celiac|coeliac|wheat/,
  dairy: /dairy|lactose|\bmilk\b/,
  egg: /\beggs?\b/,
  fish: /\bfish\b|finfish/,
  shellfish: /shellfish|shrimp|\bcrab|lobster|crustacean|mollus[ck]|\bclams?\b|oysters?\b|mussels?\b|scallops?\b/,
  nuts: /\bnuts?\b|almond|walnut|pistachio|hazelnut|pecan|cashew/,
  peanut: /peanuts?/,
  soy: /\bsoy\b|soya/,
  sesame: /sesame/,
  allium: /garlic|onion|allium|shallot/,
  nightshade: /nightshade|tomato|potato|eggplant/,
  capsicum: /chil[il]|capsicum|\bpeppers?\b/,
  citrus: /citrus|lemon|\blime\b|orange|grapefruit/,
  pork: /\bpork\b/,
  mushroom: /mushroom/,
  alcohol: /alcohol/,
  legumes: /legume|\bbeans?\b|lentil|chickpea/,
  coffee: /coffee|caffeine|espresso/,
  cocoa: /chocolate|cocoa/,
  fig: /\bfigs?\b/,
};
const STOP = new Set(['a', 'an', 'the', 'has', 'have', 'having', 'had', 'with', 'is', 'are', 'was', 'guest', 'table', 'of', 'who', 'got', 's', 'she', 'he', 'they', 'my', 'one', 'for', 'to']);

export function detectAllergens(message: string): AllergenKey[] {
  const t = ' ' + message.toLowerCase().replace(/[’']/g, "'") + ' ';
  const spans: string[] = [];
  // "allergic to X", "cannot have X", "no X"
  const after =
    /(allergic to|allergy to|allergies to|intolerant to|intolerance to|can ?not (?:have|do|eat)|can't (?:have|do|eat)|cannot (?:have|do|eat)|cant (?:have|do|eat)|does(?:n't| not) eat|avoids?|avoiding|\bno)\s+([^.;?!]{0,48})/g;
  for (const m of t.matchAll(after)) spans.push(m[2].split(/\b(having|with|pair|pairing|for the|wants?|would|they|who|ordered|eating|drinking|but|so|what|which|can|is|are)\b/)[0]);
  // "X allergy", "X intolerance"
  const before = /([a-z ,/&-]{0,60}?)\s*(allergy|allergies|allergic|intolerance|intolerant)\b/g;
  for (const m of t.matchAll(before)) {
    const words = m[1].replace(/[,/&]/g, ' ').split(/\s+/).filter(Boolean);
    const keep: string[] = [];
    for (let i = words.length - 1; i >= 0 && keep.length < 6; i--) {
      if (STOP.has(words[i])) break;
      keep.push(words[i]);
    }
    spans.push(keep.reverse().join(' '));
  }
  // "gluten-free"
  for (const m of t.matchAll(/([a-z]+)[- ]free\b/g)) spans.push(m[1]);
  if (/\bc(o)?eliac\b/.test(t)) spans.push('celiac');
  const found = new Set<AllergenKey>();
  for (const s of spans) for (const k of Object.keys(WORDS) as AllergenKey[]) if (WORDS[k].test(s)) found.add(k);
  if (found.has('nuts') && !/tree ?nut/.test(t)) found.add('peanut'); // "nut allergy" is taken as both
  return [...found];
}
