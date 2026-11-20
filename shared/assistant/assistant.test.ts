import { describe, expect, it } from 'vitest';
import { ALLERGEN_KEYS, NOTHING_OUT, boardNow, isAllergenKey, listWords, norm, type AssistantItem } from './catalog';
import { OFF_SHEET, levelFor, verdict } from './check';
import { buildLead, buildTurns, lineFor } from './prompt';
import { claimsSafe, detectAllergens, makeResolver, parseReply, splitBody } from './reply';
import { MAX_CARDS, cardFor, stampReply } from './stamp';
import { demoAnswer } from './demo';
import { SAMPLE_CATALOGS } from './sample';
import { MENUS, RESTAURANT_IDS } from '../sample-data';

const MAIN = SAMPLE_CATALOGS.main;
const resolve = makeResolver(MAIN.items);
const item = (name: string): AssistantItem => {
  const found = MAIN.items.find((i) => i.name === name);
  if (!found) throw new Error('no sample item ' + name);
  return found;
};
const board = (out: string[], low: [string, number][] = []) =>
  boardNow([...out.map((name) => ({ name, status: 'out' })), ...low.map(([name, lowCount]) => ({ name, status: 'low', lowCount }))]);

describe('the allergy answer is a lookup, never a guess', () => {
  it('reads Avoid and Ask first from the marks, with the reason', () => {
    expect(levelFor(item('Crispy Calamari'), 'shellfish')).toEqual({ level: 2, text: 'Squid.' });
    expect(levelFor(item('Crispy Calamari'), 'fish')).toEqual({ level: 1, text: 'Fried in the same oil as fish.' });
    expect(levelFor(item('Crispy Calamari'), 'pork')).toEqual({ level: 0, text: '' });
  });

  it('takes the strongest answer across several allergies and keeps every reason', () => {
    const v = verdict(item('Crispy Calamari'), ['fish', 'shellfish', 'pork']);
    expect(v.level).toBe(2);
    expect(v.why.map((w) => [w.label, w.level])).toEqual([
      ['Fish', 1],
      ['Shellfish', 2],
    ]);
  });

  it('has nothing to say when no allergy is set', () => {
    expect(verdict(item('Caesar'), [])).toEqual({ level: -1, why: [], noData: false });
  });

  it('treats an item that is not on the allergy sheet as Ask first for everything it is not marked for', () => {
    const special: AssistantItem = { name: 'Soup of the day', kind: 'food', section: 'Starters', offSheet: true, avoid: { dairy: 'Cream.' } };
    expect(levelFor(special, 'dairy').level).toBe(2);
    expect(levelFor(special, 'sesame')).toEqual({ level: 1, text: OFF_SHEET });
  });

  it('knows two things about any wine: it is alcohol, and it may be cleared with egg, milk or fish', () => {
    const chianti = item('Chianti Classico');
    expect(verdict(chianti, ['alcohol']).level).toBe(2);
    expect(verdict(chianti, ['egg']).level).toBe(1);
    expect(verdict(chianti, ['shellfish'])).toEqual({ level: 0, why: [], noData: true });
  });
});

describe('reading a reply', () => {
  it('waits while the first line is still arriving', () => {
    expect(parseReply('ALLER', false)).toEqual({ wait: true });
    expect(parseReply('ALLERGIES: egg | OTHER: none', false)).toEqual({ wait: true });
  });

  it('maps everyday words to keys and moves what has no key to OTHER', () => {
    expect(parseReply('ALLERGIES: tree nuts, peanuts, kiwi | OTHER: none\n\nHi', true)).toEqual({ wait: false, keys: ['nuts', 'peanut'], other: ['kiwi'], body: 'Hi' });
    expect(parseReply('ALLERGIES: dairy | OTHER: mustard.\n\nSkip it.', true)).toEqual({ wait: false, keys: ['dairy'], other: ['mustard'], body: 'Skip it.' });
  });

  it('shows a reply with no first line as it is', () => {
    expect(parseReply('Hello there', false)).toEqual({ wait: false, keys: [], other: [], body: 'Hello there' });
  });

  it('resolves a bracketed name only when one item clearly fits', () => {
    expect(resolve('negroni')?.name).toBe('Negroni');
    expect(resolve('Pinot Noir Willamette')?.name).toBe('Pinot Noir, Willamette Valley');
    expect(resolve('Pinot Noir')).toBeNull(); // half the name is not enough
    expect(resolve('Burrata and Peach')?.name).toBe('Burrata & Peach');
    expect(resolve('Pinot')).toBeNull(); // Pinot Noir or Pinot Grigio
    expect(resolve('Margarita')).toBeNull();
  });

  it('splits a reply into text and named items, and holds back half a bracket while it streams', () => {
    const done = splitBody('Pour the [[Chianti Classico]].\n\nSkip the [[Crispy Calamari]] and the [[Margarita]].', true, resolve);
    expect(done.found.map((i) => i.name)).toEqual(['Chianti Classico', 'Crispy Calamari']);
    expect(done.paras).toHaveLength(2);
    expect(done.paras[1]).toEqual(['Skip the ', item('Crispy Calamari'), ' and the ', 'Margarita', '.']);
    const live = splitBody('Try the [[Negr', false, resolve);
    expect(live.paras).toEqual([['Try the']]);
    expect(live.found).toEqual([]);
  });

  it('spots a reply that called something safe, but not the app\'s own "not the same as safe"', () => {
    expect(claimsSafe('Either is a safe choice.')).toBe(true);
    expect(claimsSafe('It does not contain nuts.')).toBe(true);
    expect(claimsSafe('It is Not listed. That is not the same as safe.')).toBe(false);
  });

  it('hears allergies in the way servers type them', () => {
    expect(detectAllergens('Guest has an egg allergy. Which cocktails are out?')).toEqual(['egg']);
    expect(detectAllergens('table 6 is allergic to shellfish and wants a red')).toEqual(['shellfish']);
    expect(detectAllergens('she is gluten-free')).toEqual(['gluten']);
    expect(detectAllergens('nut allergy on 12').sort()).toEqual(['nuts', 'peanut']);
    expect(detectAllergens('tree nut allergy on 12')).toEqual(['nuts']);
    expect(detectAllergens('What goes with the short rib?')).toEqual([]);
    expect(detectAllergens('How do we make the Negroni?')).toEqual([]);
  });
});

describe("the app's own check of a reply", () => {
  const found = [item('Chianti Classico'), item('Negroni'), item('Crispy Calamari')];

  it('prints a price list, with no labels, when no allergy is set', () => {
    const s = stampReply(found, [], NOTHING_OUT, [], false);
    expect(s.alerts).toEqual([]);
    expect(s.kicker).toBe('From our lists');
    expect(s.cards.map((c) => c.label)).toEqual(['', '', '']);
  });

  it('warns about Avoid first, then Ask first, and labels every item', () => {
    const s = stampReply(found, ['shellfish', 'egg'], NOTHING_OUT, [], false); // picked in this order, listed in the app's order
    expect(s.alerts).toEqual([
      { tone: 'no', text: 'Avoid for this guest: Crispy Calamari.' },
      { tone: 'ask', text: 'Ask first: Chianti Classico.' },
    ]);
    expect(s.kicker).toBe('Checked for egg and shellfish on the allergy sheet');
    expect(s.cards.map((c) => [c.item.name, c.label])).toEqual([
      ['Chianti Classico', 'Ask first'],
      ['Negroni', 'Not listed'],
      ['Crispy Calamari', 'Avoid'],
    ]);
    expect(s.cards[1].reasons).toEqual([{ tone: 'foot', text: 'Not listed is not the same as safe.' }]);
  });

  it("marks what the 86 board says is out, and what is running low", () => {
    const now = board(['Negroni', 'Pinot Noir (glass)'], [['Crispy Calamari', 3]]);
    const s = stampReply([...found, item('Pinot Noir, Willamette Valley')], [], now, [], false);
    expect(s.alerts).toEqual([{ tone: 'no', text: "86'd right now: Negroni and Pinot Noir, Willamette Valley." }]);
    expect(cardFor(item('Negroni'), [], now).label).toBe("86'd");
    expect(cardFor(item('Crispy Calamari'), [], now).reasons).toEqual([{ tone: 'foot', text: 'Running low on the board: 3 left.' }]);
  });

  it('says so when the guest cannot have something the app has no data for', () => {
    const s = stampReply([], ['dairy'], NOTHING_OUT, ['mustard'], false);
    expect(s.alerts).toEqual([{ tone: 'ask', text: 'The app has no allergy data for mustard. Ask the chef or the bar manager.' }]);
  });

  it('shows at most twelve items and counts the rest', () => {
    const s = stampReply(MAIN.items, ['egg'], NOTHING_OUT, [], false);
    expect(s.cards).toHaveLength(MAX_CARDS);
    expect(s.more).toBe(MAIN.items.length - MAX_CARDS);
  });
});

describe('what the AI is given', () => {
  const lead = buildLead(MAIN, ['egg'], board(['Tiramisu'], [['Caesar', 2]]));
  const line = (name: string) => lead.split('\n').find((l) => l.startsWith(name + ' | ')) ?? '';

  it('carries the rules, the lists, the house notes and what is known about the guest', () => {
    for (const part of ['FORMAT RULES', 'ALLERGY RULES', '86 RULES', 'KEY TABLE', 'WINE (name', 'DRINKS:', 'FOOD (name', 'HOUSE NOTES', '--- Bar manual (sample) (sample) ---', '1 oz Campari'])
      expect(lead, part).toContain(part);
    expect(lead.endsWith('KNOWN SO FAR, this guest cannot have: egg')).toBe(true);
    expect(lead).toContain('You are Ask, the bar and allergy helper for the floor staff at Main Street');
  });

  it('gives every key in the table and uses only those keys in the marks', () => {
    for (const k of ALLERGEN_KEYS) expect(lead, k).toContain(`\n${k} = `);
    expect(line('Crispy Calamari')).toBe(
      'Crispy Calamari | Starters | every menu | Fried squid, lemon aioli, marinara | AVOID: gluten, egg, shellfish, nightshade, citrus | ASK: fish',
    );
  });

  it("marks what the 86 board says, live", () => {
    expect(line('Tiramisu').endsWith(" [86'D]")).toBe(true);
    expect(line('Caesar').endsWith(' [LOW 2]')).toBe(true);
    expect(line('Negroni')).not.toContain('[');
  });

  it('gives wine its style and prices and no marks', () => {
    expect(lineFor(item('Chianti Classico'), NOTHING_OUT)).toBe('Chianti Classico | Red, medium-bodied, cherry and spice | glass $14, bottle $54');
  });

  it('sends the lead, then the last ten messages, starting on a question', () => {
    const turns = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 === 0 ? ('user' as const) : ('assistant' as const), content: 'm' + i }));
    const sent = buildTurns('LEAD', turns);
    expect(sent[0]).toEqual({ role: 'user', content: 'LEAD' });
    expect(sent.slice(1).map((t) => t.content)).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12']);
  });
});

describe('the sample lists', () => {
  it('cover every dish on each sample menu, by the name the 86 board uses', () => {
    for (const id of RESTAURANT_IDS) {
      const names = new Set(SAMPLE_CATALOGS[id].items.map((i) => norm(i.board ?? i.name)));
      for (const [, dish] of MENUS[id]) expect(names.has(norm(dish)), `${id}: ${dish}`).toBe(true);
    }
  });

  it('use only real allergen keys, and give every mark a reason', () => {
    for (const catalog of Object.values(SAMPLE_CATALOGS))
      for (const i of catalog.items)
        for (const [k, reason] of [...Object.entries(i.avoid ?? {}), ...Object.entries(i.ask ?? {})]) {
          expect(isAllergenKey(k), `${i.name}: ${k}`).toBe(true);
          expect(reason, `${i.name}: ${k}`).toMatch(/\.$/);
        }
  });

  it('have no two items the chat could confuse', () => {
    for (const catalog of Object.values(SAMPLE_CATALOGS)) {
      const find = makeResolver(catalog.items);
      for (const i of catalog.items) expect(find(i.name), i.name).toBe(i);
    }
  });
});

describe('the demo answers (no AI)', () => {
  const ask = (q: string, known: Parameters<typeof demoAnswer>[1]['known'] = [], now = NOTHING_OUT) => {
    const p = parseReply(demoAnswer(MAIN, { turns: [{ role: 'user', content: q }], known }, now), true);
    if (p.wait) throw new Error('no first line');
    return { keys: p.keys, body: p.body, named: splitBody(p.body, true, resolve).found.map((i) => i.name) };
  };

  it('answer in the format the AI uses, with the allergy it heard', () => {
    const r = ask('Shellfish allergy. Is the Crispy Calamari OK?');
    expect(r.keys).toEqual(['shellfish']);
    expect(r.body).toBe('[[Crispy Calamari]] is Avoid for this guest.\n\nTell the kitchen and the bar about the allergy.');
  });

  it('never suggest what is Avoid for the guest or 86\'d on the board', () => {
    expect(ask('A red by the glass').named).toEqual(['Pinot Noir, Willamette Valley', 'Chianti Classico']);
    expect(ask('A red by the glass', [], board(['Pinot Noir (glass)'])).named).toEqual(['Chianti Classico']);
    expect(ask('A red by the glass', ['alcohol']).named).toEqual([]);
    expect(ask('Something with no alcohol').named).toEqual(['Lemon Basil Soda']);
  });

  it("say what the board has 86'd", () => {
    expect(ask("What is 86'd right now?", [], board(['Tiramisu'])).body).toBe("86'd right now: [[Tiramisu]]. I will not suggest them.");
    expect(ask("What is 86'd right now?").body).toBe("Nothing on my lists is 86'd right now.");
  });

  it('read a house drink from the bar manual', () => {
    expect(ask('How do we make the Negroni?').body).toBe('[[Negroni]], from the bar manual (sample): 1 oz gin, 1 oz Campari, 1 oz sweet vermouth. Stir over ice, strain over one large cube, orange peel.');
  });

  it('never call anything safe', () => {
    for (const q of [...MAIN.starters, 'egg allergy, what can they have', 'hello']) expect(claimsSafe(ask(q).body), q).toBe(false);
  });
});

describe('small helpers', () => {
  it('lists words the way people say them', () => {
    expect([listWords([]), listWords(['a']), listWords(['a', 'b']), listWords(['a', 'b', 'c'])]).toEqual(['', 'a', 'a and b', 'a, b and c']);
  });
});
