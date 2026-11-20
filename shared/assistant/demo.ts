// The demo and the preview have no AI behind them. This stands in for it: it
// looks up what the question names on the sample lists and answers in the
// same format the AI uses (line 1 with the allergies, names in [[brackets]]).
// Everything after that is the real app: the labels, the warnings and the
// 86 marks are worked out the same way they are for an AI answer.
import type { AskInput } from './prompt';
import type { AllergenKey, AssistantCatalog, AssistantItem, BoardNow } from './catalog';
import { allergenLabel, inOrder, isOut, listWords, norm } from './catalog';
import { verdict } from './check';
import { detectAllergens } from './reply';

const tag = (i: AssistantItem): string => `[[${i.name}]]`;

// Items the question names: the whole name, or its last word when that word is long and belongs to one item only.
function namedIn(question: string, items: AssistantItem[]): AssistantItem[] {
  const q = ' ' + norm(question) + ' ';
  const lastWord = (i: AssistantItem) => norm(i.name).split(' ').pop() ?? '';
  const count = new Map<string, number>();
  for (const i of items) count.set(lastWord(i), (count.get(lastWord(i)) ?? 0) + 1);
  return items.filter((i) => {
    if (q.includes(' ' + norm(i.name) + ' ') || (i.board !== undefined && q.includes(' ' + norm(i.board) + ' '))) return true;
    const w = lastWord(i);
    return w.length >= 5 && count.get(w) === 1 && q.includes(' ' + w + ' ');
  });
}

function sayItem(i: AssistantItem, keys: AllergenKey[], now: BoardNow): string {
  if (isOut(i, now)) return `${tag(i)} is 86'd right now.`;
  const v = verdict(i, keys);
  if (v.level === 2) return `${tag(i)} is Avoid for this guest.`;
  if (v.level === 1) return `${tag(i)}: ask first.`;
  if (v.level === 0) return `${tag(i)} is Not listed for ${listWords(keys.map((k) => allergenLabel(k).toLowerCase()))}.`;
  return `${tag(i)}: ${(i.about ?? i.section).replace(/\.$/, '')}.`;
}

export function demoAnswer(catalog: AssistantCatalog, input: AskInput, now: BoardNow): string {
  const question = input.turns[input.turns.length - 1]?.content ?? '';
  const keys = inOrder([...input.known, ...detectAllergens(question)]);
  const q = ' ' + norm(question) + ' ';
  const has = (re: RegExp) => re.test(q);
  const usable = (i: AssistantItem) => !isOut(i, now) && verdict(i, keys).level < 2;
  const named = namedIn(question, catalog.items);
  const lines: string[] = [];

  if (has(/ 86 | 86 d | eighty six | sold out | is out | are out of /) && named.length === 0 && keys.length === 0) {
    const out = catalog.items.filter((i) => isOut(i, now));
    lines.push(out.length ? `86'd right now: ${listWords(out.map(tag))}. I will not suggest them.` : "Nothing on my lists is 86'd right now.");
  } else if (named.length > 0) {
    const first = named[0];
    const recipe = has(/ make | made | build | recipe | spec /) ? catalog.docs.flatMap((d) => d.text.split('\n').map((line) => ({ d, line }))).find((x) => norm(x.line).startsWith(norm(first.name) + ' ')) : undefined;
    if (recipe) lines.push(`${tag(first)}, from the ${recipe.d.title.toLowerCase()}: ${recipe.line.slice(recipe.line.indexOf(':') + 1).trim()}`);
    else for (const i of named.slice(0, 4)) lines.push(sayItem(i, keys, now));
  } else if (has(/ no alcohol | non alcoholic | zero proof | mocktail | no caffeine /)) {
    const picks = catalog.items.filter((i) => i.kind === 'drink' && !i.avoid?.alcohol && !(has(/ caffeine /) && i.avoid?.coffee) && usable(i)).slice(0, 2);
    lines.push(picks.length ? `With no alcohol: ${listWords(picks.map(tag))}.` : 'Nothing with no alcohol is on my lists.');
  } else if (has(/ wine | red | white | rose | bubbles | sparkling | glass | bottle /)) {
    const want = has(/ red /) ? 'red' : has(/ white /) ? 'white' : has(/ rose /) ? 'rose' : has(/ bubbles | sparkling /) ? 'sparkling' : '';
    const all = catalog.items.filter((i) => i.kind === 'wine' && (want === '' || norm(i.section) === want));
    const wines = all.filter(usable).slice(0, 2);
    if (wines.length) lines.push(wines.map((i) => `${tag(i)} is ${i.about ?? i.section.toLowerCase()}.`).join(' '));
    else lines.push(all.length ? "Every wine like that is Avoid for this guest or 86'd right now." : 'Nothing like that is on my wine list.');
  } else if (has(/ cocktail | cocktails | drink | drinks | beer /)) {
    const picks = catalog.items.filter((i) => i.kind === 'drink' && usable(i)).slice(0, 2);
    lines.push(picks.length ? picks.map((i) => sayItem(i, [], now)).join(' ') : 'Nothing like that is on my lists.');
  } else if (keys.length > 0) {
    const avoid = catalog.items.filter((i) => verdict(i, keys).level === 2).slice(0, 6);
    lines.push(avoid.length ? `Avoid for this guest: ${listWords(avoid.map(tag))}.` : 'Nothing on my lists is marked Avoid for that. Not listed is not the same as a clear answer, so check with the chef.');
  } else {
    lines.push('This is the demo, so there is no AI behind me. Name a dish or a drink from the sample menu and I will show its labels.');
  }

  if (keys.length > 0) lines.push('Tell the kitchen and the bar about the allergy.');
  return `ALLERGIES: ${keys.length ? keys.join(', ') : 'none'} | OTHER: none\n\n${lines.join('\n\n')}`;
}
