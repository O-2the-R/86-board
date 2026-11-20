// The app's own check of every item a reply names: the warnings shown above
// the reply and the ticket of labels under it. It is worked out again
// whenever the guest's allergies or the 86 board change, so an old reply
// never shows an old label.
import type { AllergenKey, AssistantItem, BoardNow } from './catalog';
import { allergenLabel, inOrder, isOut, listWords, lowCount } from './catalog';
import { verdict } from './check';

export const LABEL = { no: 'Avoid', ask: 'Ask first', ok: 'Not listed', nodata: 'No allergy info', out: "86'd" } as const;
export const MAX_CARDS = 12;

export interface CardReason {
  tone: 'no' | 'ask' | 'foot';
  label?: string; // the allergen this reason is about
  text: string;
}

export interface Card {
  item: AssistantItem;
  state: 'out' | 'no' | 'ask' | 'fine';
  tone: '' | 'no' | 'ask' | 'ok' | 'nodata';
  label: string; // '' when there is nothing to check
  reasons: CardReason[];
}

export interface Stamp {
  alerts: { tone: 'no' | 'ask'; text: string }[];
  kicker: string; // the line on top of the ticket
  checked: boolean; // an allergy was checked (not just a price list)
  cards: Card[];
  more: number; // items named beyond the ones shown
  safeNote: boolean; // the reply called something safe
}

export function cardFor(item: AssistantItem, keys: AllergenKey[], now: BoardNow): Card {
  const v = verdict(item, keys);
  const out = isOut(item, now);
  const low = lowCount(item, now);
  const reasons: CardReason[] = [];
  if (out) reasons.push({ tone: 'no', text: "86'd on the board right now." });
  for (const w of v.why) reasons.push({ tone: w.level === 2 ? 'no' : 'ask', label: w.label, text: w.text });
  if (v.level === 0 && !out) reasons.push({ tone: 'foot', text: v.noData ? 'Wine is not on the allergy sheet.' : 'Not listed is not the same as safe.' });
  if (!out && low !== undefined) reasons.push({ tone: 'foot', text: `Running low on the board: ${low} left.` });
  const tone = out || v.level === 2 ? 'no' : v.level === 1 ? 'ask' : v.level === 0 ? (v.noData ? 'nodata' : 'ok') : '';
  const label = out ? LABEL.out : tone === '' ? '' : LABEL[tone];
  return { item, state: out ? 'out' : v.level === 2 ? 'no' : v.level === 1 ? 'ask' : 'fine', tone, label, reasons };
}

export function stampReply(found: AssistantItem[], picked: AllergenKey[], now: BoardNow, other: string[], safeNote: boolean): Stamp {
  const keys = inOrder(picked);
  const all = found.map((item) => cardFor(item, keys, now));
  const names = (state: Card['state']) => all.filter((c) => c.state === state).map((c) => c.item.name);
  const alerts: Stamp['alerts'] = [];
  if (names('no').length) alerts.push({ tone: 'no', text: `Avoid for this guest: ${listWords(names('no'))}.` });
  if (names('out').length) alerts.push({ tone: 'no', text: `86'd right now: ${listWords(names('out'))}.` });
  if (names('ask').length) alerts.push({ tone: 'ask', text: `Ask first: ${listWords(names('ask'))}.` });
  if (other.length) alerts.push({ tone: 'ask', text: `The app has no allergy data for ${listWords(other)}. Ask the chef or the bar manager.` });
  return {
    alerts,
    kicker: keys.length ? `Checked for ${listWords(keys.map((k) => allergenLabel(k).toLowerCase()))} on the allergy sheet` : 'From our lists',
    checked: keys.length > 0,
    cards: all.slice(0, MAX_CARDS),
    more: Math.max(0, all.length - MAX_CARDS),
    safeNote,
  };
}
