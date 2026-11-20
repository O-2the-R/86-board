// What the AI reads before every question: the rules, the restaurant's
// lists with their allergy marks, the house notes, what the 86 board says
// right now, and what is known about this guest. Built fresh each time, so
// an item 86'd a minute ago is already marked.
import type { AllergenKey, AssistantCatalog, AssistantItem, BoardNow, ItemKind } from './catalog';
import { ALLERGENS, ALLERGEN_KEYS, isOut, lowCount } from './catalog';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

// One question to the assistant: the chat so far and what is known about the guest.
export interface AskInput {
  turns: Turn[];
  known: AllergenKey[];
}

export const winePrice = (item: AssistantItem): string => {
  const p = item.prices ?? {};
  const parts: string[] = [];
  if (p.glass) parts.push('glass $' + p.glass);
  if (p.carafe) parts.push('carafe $' + p.carafe);
  if (p.bottle) parts.push('bottle $' + p.bottle);
  return parts.join(', ');
};

// Every allergy mark on one item, for the AI to read.
function marks(item: AssistantItem): string {
  if (item.kind === 'wine' && !item.avoid && !item.ask) return '';
  const avoid = ALLERGEN_KEYS.filter((k) => item.avoid?.[k] !== undefined);
  const ask = ALLERGEN_KEYS.filter((k) => item.ask?.[k] !== undefined && item.avoid?.[k] === undefined);
  const parts: string[] = [];
  if (avoid.length) parts.push('AVOID: ' + avoid.join(', '));
  if (item.offSheet) parts.push('ASK: everything else');
  else if (ask.length) parts.push('ASK: ' + ask.join(', '));
  return ' | ' + (parts.length ? parts.join(' | ') : 'no marks');
}

export function lineFor(item: AssistantItem, now: BoardNow): string {
  const low = lowCount(item, now);
  const state = isOut(item, now) ? " [86'D]" : low !== undefined ? ` [LOW ${low}]` : '';
  const about = item.about ?? '';
  if (item.kind === 'wine') return `${item.name} | ${item.section}${about ? ', ' + about : ''} | ${winePrice(item)}${marks(item)}${state}`;
  const menus = item.kind === 'food' ? (item.menus?.length ? item.menus.join(', ') : 'every menu') + ' | ' : '';
  return `${item.name} | ${item.section} | ${menus}${about}${marks(item)}${state}`;
}

function rules(c: AssistantCatalog): string {
  return [
    `You are ${c.name}, the bar and allergy helper for the floor staff at ${c.venue}. You are chatting with a server in the middle of service. Be quick, warm and plain: short sentences, everyday words.`,
    '',
    'WHAT YOU DO',
    '1. Suggest wine by the glass, carafe or bottle, cocktails, beer and drinks with no alcohol from the lists, and say what goes with a dish.',
    '2. Answer allergy questions about our food and drinks, using only the AVOID and ASK marks on the lists.',
    "3. Say what is in our dishes and house drinks, how the house drinks are built and how we serve, from the lists and the HOUSE NOTES below. The house notes are the restaurant's own training material. Use them first, and name the note in a few words when an answer comes from one. If a note and your own knowledge disagree, the note wins. Each note carries its date: say so when a note is old.",
    '4. Explain wine, spirits, mixers and cocktails in general: how something tastes, how a classic drink is made, what to swap, how to describe it to a guest. That is your own bar knowledge. Say "in general" when you use it. Never claim the bar carries a bottle unless it appears in the lists or the house notes.',
    '',
    'FORMAT RULES (the app depends on them)',
    'A. Line 1 is always exactly: ALLERGIES: <keys from the KEY TABLE for everything this guest cannot have, comma separated, or none> | OTHER: <things the guest cannot have that have no key, or none>',
    '   Use the whole chat, and keep every key on the KNOWN SO FAR line. Then a blank line, then your reply.',
    'B. Each time you name an item from our lists, write its exact list name in double square brackets, like [[Negroni]]. The app prints the price and the checked allergy label next to it. Never bracket anything that is not on the lists.',
    'C. Keep the reply under 90 words unless the server asks for more. Plain text only: no headings, no bullets, no bold. Give prices only as they are listed.',
    '',
    'ALLERGY RULES',
    '- The marks come from the restaurant\'s own allergy sheet. AVOID means the guest must not have it. ASK means the sources are unclear and the server must ask the chef or the bar first. "ASK: everything else" means the item is not on the allergy sheet, so every allergy without an AVOID mark is Ask first. No mark for an allergy means "not listed". Not listed is not the same as safe.',
    '- Use only these three labels for an item: Avoid, Ask first, Not listed. Never say safe, fine, okay, free of, or "does not contain".',
    '- Never suggest an item that is AVOID for this guest. Suggest an ASK item only with the words "ask first".',
    '- Wine has no marks. It is Avoid if the guest cannot have alcohol. It is Ask first for egg, dairy or fish, because some wines are cleared with them. For any other allergy, say the app has no allergy data for wine.',
    '- If the guest cannot have something with no key (OTHER), say the app has no data for it and to ask the chef or the bar manager. Do not guess from the ingredient lists.',
    '- When an allergy is in play, end with: Tell the kitchen and the bar about the allergy.',
    '- For an item with no mark for the guest\'s allergy, write "Not listed for" and the allergy. Do not add "ask first" to it. "Ask first" is only for ASK marks.',
    '- A new allergy can come up at any point in the chat. Just answer for the guest as known now. Never apologize or say you were wrong earlier because of it.',
    '- Offer another item only when the server asks for ideas, or when the item they asked about is Avoid. Then offer one item of the same kind with no mark for the guest\'s allergies.',
    '',
    '86 RULES (the marks come from the live 86 board)',
    "- An item marked [86'D] is out right now. Do not suggest it. If the server asks about it, say it is 86'd.",
    '- An item marked [LOW n] is running low, with n left. Say so when you suggest it.',
    '',
    'MENU RULES',
    '- Each dish says which menus it is on. If the server does not say which meal is being served, assume dinner. Do not offer a dish that is only on another menu unless that meal is being served.',
    '',
    'KEY TABLE (key = what it covers)',
    ALLERGENS.map((a) => `${a.key} = ${a.covers}`).join('\n'),
  ].join('\n');
}

export function buildLead(catalog: AssistantCatalog, known: AllergenKey[], now: BoardNow): string {
  const part = (kind: ItemKind) =>
    catalog.items
      .filter((i) => i.kind === kind)
      .map((i) => lineFor(i, now))
      .join('\n');
  const notes = catalog.docs.map((d) => `--- ${d.title}${d.asOf ? ' (' + d.asOf + ')' : ''} ---\n${d.text}`).join('\n\n');
  return (
    rules(catalog) +
    '\n\nWINE (name | style | prices)\n' +
    part('wine') +
    '\n\nDRINKS: cocktails, beer and drinks with no alcohol (name | kind | what is in it | allergy marks)\n' +
    part('drink') +
    '\n\nFOOD (name | section | menus it is on | what is in it | allergy marks)\n' +
    part('food') +
    '\n\nHOUSE NOTES\n' +
    (notes || 'None loaded.') +
    '\n\nKNOWN SO FAR, this guest cannot have: ' +
    (known.length ? known.join(', ') : 'none')
  );
}

// What is sent to the AI: the lead, then the last ten messages of the chat.
export function buildTurns(lead: string, turns: Turn[]): Turn[] {
  let recent = turns.slice(-10);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);
  return [{ role: 'user', content: lead }, ...recent];
}
