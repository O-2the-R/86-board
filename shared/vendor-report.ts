// The vendor report: how often each supplier left a restaurant short, worked
// out from the 86 history. Plain functions with no AWS and no browser in them,
// so the app (History) and, later, the morning email can count the same way.
//
// What counts is the 86 note. Two of the quick notes on the 86 sheet say the
// delivery was the problem ("Didn't come in", "Vendor short"), and a typed
// note such as "Chesapeake shorted the order" counts too. "Sold out" and
// "Quality, pulled" do not: the supplier delivered.

// Read against the note in lower case, with phone-keyboard apostrophes made
// plain. Each line is one way people say "the delivery let us down".
const SUPPLY_NOTES: RegExp[] = [
  /\b(didn'?t|did not|never) (come|came|arrive|arrived|show|showed)\b/, // didn't come in, never arrived
  /\b(not|wasn'?t|weren'?t) delivered\b/,
  /\b(no|missed|late) (delivery|truck)\b/,
  /\b(delivery|truck) (is |was |running )?late\b/,
  /\bshorted\b/, // "Chesapeake shorted the order"
  /\b(vendor|supplier|purveyor)s?\b.{0,20}\bshort\b(?! ?ribs?\b)/, // vendor short
  /\b(delivery|order|truck|shipment) (came in |came |was |is |arrived )?short\b(?! ?ribs?\b)/, // order came in short
  /\bcame in short\b(?! ?ribs?\b)/,
  /\bback[- ]?order/, // backordered, on back order
];

// True when an 86 note blames the delivery. "Short rib sold out" is not one.
export function isSupplyNote(note: string | null | undefined): boolean {
  if (!note) return false;
  const plain = note.toLowerCase().replace(/[‘’]/g, "'");
  return SUPPLY_NOTES.some((p) => p.test(plain));
}

// Just the parts of a history entry and a menu item the report reads, so the
// app's shapes and the database's rows both fit.
export interface ReportEvent {
  itemId: string;
  itemName: string;
  startedAt: string; // ISO time it was 86'd
  endedAt?: string | null; // missing while it is still out
  note?: string | null;
}

export interface ReportItem {
  id: string;
  vendor?: string | null; // who supplies it, as named on the menu item
}

export interface VendorItemCount {
  name: string;
  times: number;
}

// One supplier's line.
export interface VendorLine {
  vendor: string;
  times: number; // 86s caused by a short or missing delivery
  ms: number; // how long those items were off the menu, added up
  items: VendorItemCount[]; // what was affected, most often first
  stillOut: number; // how many of them are out right now
  lastAt: string; // when the latest one started, ISO
}

export interface VendorReport {
  vendors: VendorLine[]; // worst first
  times: number; // every 86 counted above
  noVendor: number; // delivery 86s on items with no vendor named, so nobody to count them against
}

// The report for one restaurant: its history entries and its menu.
export function vendorReport(events: ReportEvent[], items: ReportItem[], now: number = Date.now()): VendorReport {
  const vendorOf = new Map(items.map((i) => [i.id, (i.vendor ?? '').trim()]));
  const lines = new Map<string, VendorLine & { counts: Map<string, number> }>();
  let noVendor = 0;

  for (const e of events) {
    if (!isSupplyNote(e.note)) continue;
    const vendor = vendorOf.get(e.itemId);
    if (!vendor) {
      noVendor += 1;
      continue;
    }
    const start = Date.parse(e.startedAt);
    const end = e.endedAt ? Date.parse(e.endedAt) : now;
    const ms = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;

    const line = lines.get(vendor) ?? { vendor, times: 0, ms: 0, items: [], stillOut: 0, lastAt: e.startedAt, counts: new Map<string, number>() };
    line.times += 1;
    line.ms += ms;
    if (!e.endedAt) line.stillOut += 1;
    if (start > Date.parse(line.lastAt)) line.lastAt = e.startedAt;
    line.counts.set(e.itemName, (line.counts.get(e.itemName) ?? 0) + 1);
    lines.set(vendor, line);
  }

  const vendors = [...lines.values()]
    .map(({ counts, ...line }) => ({
      ...line,
      items: [...counts.entries()].map(([name, times]) => ({ name, times })).sort((a, b) => b.times - a.times || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.times - a.times || b.ms - a.ms || a.vendor.localeCompare(b.vendor));

  return { vendors, times: vendors.reduce((n, v) => n + v.times, 0), noVendor };
}

// "Pan-Roasted Halibut ×2, Whole Branzino", the line under a supplier's bar.
export const itemsLine = (items: VendorItemCount[]): string => items.map((i) => (i.times > 1 ? `${i.name} ×${i.times}` : i.name)).join(', ');
