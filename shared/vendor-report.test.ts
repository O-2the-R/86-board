import { describe, expect, it } from 'vitest';
import { isSupplyNote, itemsLine, vendorReport, type ReportEvent, type ReportItem } from './vendor-report';

const HOUR = 3_600_000;
const NOW = Date.parse('2026-11-16T17:00:00Z');
const ago = (hours: number) => new Date(NOW - hours * HOUR).toISOString();

const ITEMS: ReportItem[] = [
  { id: 'main-halibut', vendor: 'Chesapeake Seafood Co.' },
  { id: 'main-branzino', vendor: 'Chesapeake Seafood Co.' },
  { id: 'main-ribeye', vendor: 'Capital Meats' },
  { id: 'main-short-rib', vendor: 'Capital Meats' },
  { id: 'main-tiramisu', vendor: 'Metro Bakery' },
  { id: 'main-cacio', vendor: undefined }, // made in house
];

// started `hoursAgo`, out for `hours`; leave `hours` out for one still out
const ev = (itemId: string, itemName: string, note: string | undefined, hoursAgo: number, hours?: number): ReportEvent => ({
  itemId,
  itemName,
  note,
  startedAt: ago(hoursAgo),
  endedAt: hours === undefined ? undefined : ago(hoursAgo - hours),
});

describe('which 86 notes blame the delivery', () => {
  it('counts the two quick notes about deliveries', () => {
    expect(isSupplyNote("Didn't come in")).toBe(true);
    expect(isSupplyNote('Vendor short')).toBe(true);
  });

  it('does not count the other quick notes', () => {
    for (const note of ['Sold out', 'Quality, pulled', 'Back tomorrow']) expect(isSupplyNote(note), note).toBe(false);
  });

  it('counts a typed note that says the same thing', () => {
    for (const note of [
      'Chesapeake shorted the order, back Tuesday',
      'didnt come in today',
      'Never arrived',
      'Order came in short',
      'Supplier was short again',
      'Truck is late, back at 6',
      'No delivery Monday',
      'Not delivered',
      'Backordered until Friday',
      'On back order',
    ])
      expect(isSupplyNote(note), note).toBe(true);
  });

  it('reads a phone keyboard’s curly apostrophe', () => {
    expect(isSupplyNote('Didn’t come in')).toBe(true);
  });

  it('is not fooled by short rib, or by a note about something else', () => {
    for (const note of ['Short rib sold out', 'Big order took all the short rib', 'New vendor for short ribs', 'Machine down', 'Out until Thursday', '', undefined, null])
      expect(isSupplyNote(note), String(note)).toBe(false);
  });
});

describe('the vendor report', () => {
  it('counts each supplier’s short deliveries, the time off the menu and the items', () => {
    const report = vendorReport(
      [
        ev('main-halibut', 'Pan-Roasted Halibut', 'Vendor short', 150, 4),
        ev('main-halibut', 'Pan-Roasted Halibut', 'Chesapeake shorted the order', 3), // still out
        ev('main-branzino', 'Whole Branzino', "Didn't come in", 78), // still out
        ev('main-ribeye', 'Ribeye 16 oz', 'Vendor short', 290, 20),
        ev('main-tiramisu', 'Tiramisu', 'Sold out', 74, 2), // the bakery delivered
      ],
      ITEMS,
      NOW,
    );

    expect(report.vendors.map((v) => v.vendor)).toEqual(['Chesapeake Seafood Co.', 'Capital Meats']);
    const [fish, meat] = report.vendors;
    expect(fish.times).toBe(3);
    expect(fish.ms).toBe((4 + 3 + 78) * HOUR);
    expect(fish.items).toEqual([
      { name: 'Pan-Roasted Halibut', times: 2 },
      { name: 'Whole Branzino', times: 1 },
    ]);
    expect(fish.stillOut).toBe(2);
    expect(fish.lastAt).toBe(ago(3));
    expect(meat).toMatchObject({ times: 1, ms: 20 * HOUR, stillOut: 0, lastAt: ago(290) });
    expect(report.times).toBe(4);
    expect(report.noVendor).toBe(0);
  });

  it('puts the supplier who shorted most often on top, then the longest time out, then the name', () => {
    const report = vendorReport(
      [
        ev('main-tiramisu', 'Tiramisu', "Didn't come in", 200, 30),
        ev('main-ribeye', 'Ribeye 16 oz', 'Vendor short', 100, 5),
        ev('main-halibut', 'Pan-Roasted Halibut', 'Vendor short', 60, 2),
        ev('main-branzino', 'Whole Branzino', 'Vendor short', 50, 2),
      ],
      ITEMS,
      NOW,
    );
    expect(report.vendors.map((v) => `${v.vendor} ${v.times}`)).toEqual(['Chesapeake Seafood Co. 2', 'Metro Bakery 1', 'Capital Meats 1']);
  });

  it('leaves out an item with no vendor named, and says how many', () => {
    const report = vendorReport(
      [
        ev('main-cacio', 'Cacio e Pepe', "Didn't come in", 20, 3), // no vendor on the menu item
        ev('main-gone', 'Off the menu now', 'Vendor short', 30, 3), // the item is no longer on the menu
        ev('main-ribeye', 'Ribeye 16 oz', 'Vendor short', 40, 3),
      ],
      ITEMS,
      NOW,
    );
    expect(report.vendors.map((v) => v.vendor)).toEqual(['Capital Meats']);
    expect(report.noVendor).toBe(2);
    expect(report.times).toBe(1);
  });

  it('is empty when nobody was short', () => {
    expect(vendorReport([ev('main-tiramisu', 'Tiramisu', 'Sold out', 74, 2), ev('main-ribeye', 'Ribeye 16 oz', undefined, 10, 1)], ITEMS, NOW)).toEqual({ vendors: [], times: 0, noVendor: 0 });
    expect(vendorReport([], [], NOW)).toEqual({ vendors: [], times: 0, noVendor: 0 });
  });

  it('never counts time backwards', () => {
    const odd: ReportEvent = { itemId: 'main-ribeye', itemName: 'Ribeye 16 oz', note: 'Vendor short', startedAt: ago(2), endedAt: ago(5) };
    expect(vendorReport([odd], ITEMS, NOW).vendors[0].ms).toBe(0);
  });
});

describe('the items line under a supplier', () => {
  it('names each item once, with a count when it happened more than once', () => {
    expect(itemsLine([{ name: 'Pan-Roasted Halibut', times: 2 }, { name: 'Whole Branzino', times: 1 }])).toBe('Pan-Roasted Halibut ×2, Whole Branzino');
    expect(itemsLine([])).toBe('');
  });
});
