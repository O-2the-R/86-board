import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BadLists, LIMITS, cleanCatalog, countsOf, parseLists } from './load';
import { SAMPLE_CATALOGS } from './sample';
import { leadFixed } from './prompt';

const TODAY = 'Nov 20, 2026';
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const good = () => copy(SAMPLE_CATALOGS.main) as unknown as Record<string, unknown> & { items: Record<string, unknown>[]; docs: Record<string, unknown>[] };
const calamari = (raw: { items: Record<string, unknown>[] }) => raw.items.find((i) => i.name === 'Crispy Calamari')!;
const why = (raw: unknown): string => {
  try {
    cleanCatalog('main', raw, TODAY);
  } catch (e) {
    if (e instanceof BadLists) return e.message;
    throw e;
  }
  return 'accepted';
};

describe('loading a restaurant\'s lists', () => {
  it('takes each sample restaurant\'s lists as they are', () => {
    for (const [id, sample] of Object.entries(SAMPLE_CATALOGS)) expect(cleanCatalog(id, copy(sample), TODAY), id).toEqual(sample);
  });

  it('takes the sample file the owner can download', () => {
    const lists = cleanCatalog('main', parseLists(readFileSync(new URL('../../public/ask-lists.example.json', import.meta.url), 'utf8')), TODAY);
    expect(countsOf(lists)).toEqual({ items: 6, notes: 1 });
    expect(lists.items.find((i) => i.name === 'Special of the Day')?.offSheet).toBe(true);
    expect(lists.items.find((i) => i.name === 'Chianti Classico')?.board).toBe('Chianti (glass)');
  });

  it('files the lists under the restaurant they were loaded for, whatever the file says', () => {
    const raw = good();
    raw.restaurantId = 'water';
    expect(cleanCatalog('counter', raw, TODAY).restaurantId).toBe('counter');
  });

  it('fills in a name and a date when the file has none', () => {
    const raw = good();
    delete raw.name;
    delete raw.asOf;
    const lists = cleanCatalog('main', raw, TODAY);
    expect(lists.name).toBe('Ask');
    expect(lists.asOf).toBe('Loaded Nov 20, 2026');
  });

  it('keeps only the fields the app knows', () => {
    const raw = good();
    calamari(raw).secret = 'x';
    raw.note = 'x';
    const lists = cleanCatalog('main', raw, TODAY);
    expect(JSON.stringify(lists)).not.toContain('secret');
    expect(Object.keys(lists).sort()).toEqual(['asOf', 'docs', 'items', 'name', 'restaurantId', 'starters', 'venue']);
  });

  it('says what is wrong, and where, in plain words', () => {
    expect(why([])).toMatch(/one set of lists/);
    expect(why({ venue: 'x' })).toMatch(/no "items"/);

    let raw = good();
    delete raw.venue;
    expect(why(raw)).toMatch(/"venue".* is missing/);

    raw = good();
    calamari(raw).kind = 'dessert';
    expect(why(raw)).toBe('Crispy Calamari: "kind" must be food, drink or wine.');

    raw = good();
    calamari(raw).avoid = { chilli: 'Chili oil.' };
    expect(why(raw)).toMatch(/^Crispy Calamari: "avoid": "chilli" is not an allergen key\. The keys are: gluten, dairy, /);

    raw = good();
    calamari(raw).avoid = { egg: '' };
    expect(why(raw)).toBe('Crispy Calamari: "avoid", the reason for egg is missing.');

    raw = good();
    raw.items.push({ name: 'crispy  CALAMARI', kind: 'food', section: 'Starters' });
    expect(why(raw)).toMatch(/Two items read as the same name: "Crispy Calamari" and "crispy CALAMARI"/);

    raw = good();
    calamari(raw).name = 'Calamari [new]';
    expect(why(raw)).toMatch(/cannot contain \[ \] or \|/);

    raw = good();
    calamari(raw).prices = { glass: '14' };
    expect(why(raw)).toBe('Crispy Calamari: the glass price must be a number, like 14.');

    raw = good();
    raw.docs[0].text = '';
    expect(why(raw)).toBe('Bar manual (sample): the text is missing.');
  });

  it('refuses lists too long for the AI to read before every question', () => {
    let raw = good();
    raw.docs = Array.from({ length: 4 }, (_, i) => ({ title: `Manual ${i + 1}`, text: 'word '.repeat(10_000) }));
    expect(why(raw)).toMatch(/too long for the AI to read before every question \(about .* characters; the limit is 150,000\)\. Shorten the house notes\./);
    raw.docs = [{ title: 'Manual', text: 'x'.repeat(LIMITS.docChars + 1) }];
    expect(why(raw)).toBe('Manual is too long (60,001 characters; the limit is 60,000).');
    // other alphabets take more room per letter, for the AI as well
    raw = good();
    raw.docs = Array.from({ length: 2 }, (_, i) => ({ title: `手册 ${i + 1}`, text: '菜'.repeat(30_000) }));
    expect(why(raw)).toMatch(/too long for the AI to read/);
  });

  it('leaves what the AI reads within the limit for every sample', () => {
    for (const sample of Object.values(SAMPLE_CATALOGS)) expect(leadFixed(sample).length).toBeLessThan(LIMITS.leadBytes / 10);
  });
});

describe('reading the file', () => {
  it('reads JSON, with or without the invisible mark some editors put first', () => {
    expect(parseLists('﻿{"items":[]}')).toEqual({ items: [] });
  });

  it('says so when the file is not JSON or is too big', () => {
    expect(() => parseLists('name,kind\nNegroni,drink')).toThrow(/not a lists file the app can read/);
    expect(() => parseLists('"' + 'é'.repeat(LIMITS.fileBytes / 2) + '"')).toThrow(/too big \(250,002 bytes; the limit is 250,000\)/);
  });
});
