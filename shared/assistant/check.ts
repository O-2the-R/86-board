// The allergy answer for one item. It is a lookup in the restaurant's own
// marks, never a guess: Avoid, Ask first, or Not listed. Nothing is ever
// called safe.
import type { AllergenKey, AssistantItem } from './catalog';
import { allergenLabel } from './catalog';

export interface Why {
  key: AllergenKey;
  label: string;
  level: 1 | 2;
  text: string;
}

export interface Verdict {
  level: -1 | 0 | 1 | 2; // -1 no allergy to check, 0 not listed, 1 ask first, 2 avoid
  why: Why[];
  noData: boolean; // a wine with nothing on file for these allergens
}

export const OFF_SHEET = 'This item is not on the allergy sheet. Ask the chef or the bar.';
export const WINE_FINING = 'Some wines are cleared with egg, milk or fish products. The wine list does not say. Ask a manager.';
const WINE_ASK: AllergenKey[] = ['egg', 'dairy', 'fish'];

export function levelFor(item: AssistantItem, key: AllergenKey): { level: 0 | 1 | 2; text: string } {
  const avoid = item.avoid?.[key];
  if (avoid !== undefined) return { level: 2, text: avoid };
  const ask = item.ask?.[key];
  if (ask !== undefined) return { level: 1, text: ask };
  // A wine list carries no allergy marks. Two things are still known about any wine.
  if (item.kind === 'wine') {
    if (key === 'alcohol') return { level: 2, text: 'Wine is alcohol.' };
    if (WINE_ASK.includes(key)) return { level: 1, text: WINE_FINING };
    return { level: 0, text: '' };
  }
  if (item.offSheet) return { level: 1, text: OFF_SHEET };
  return { level: 0, text: '' };
}

export function verdict(item: AssistantItem, keys: AllergenKey[]): Verdict {
  if (keys.length === 0) return { level: -1, why: [], noData: false };
  let level: 0 | 1 | 2 = 0;
  const why: Why[] = [];
  for (const key of keys) {
    const r = levelFor(item, key);
    if (r.level === 0) continue;
    why.push({ key, label: allergenLabel(key), level: r.level, text: r.text });
    if (r.level > level) level = r.level;
  }
  return { level, why, noData: item.kind === 'wine' && level === 0 };
}
