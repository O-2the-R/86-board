// The vendor note: when something has been 86'd for three days or more, the
// manager gets a ready-to-send email to the item's supplier. Shared by the
// app (the note sheet) and the server (the morning email), so both say the
// same thing. Nothing here sends anything: the manager sends it from their
// own email, so the vendor's reply comes back to them.

export const LONG_OUT_HOURS = 72;
const HOUR = 3_600_000;

// Out for three days or more, counted from the moment it was 86'd.
export function isLongOut(outSince: string | null | undefined, now: number = Date.now()): boolean {
  if (!outSince) return false;
  const t = Date.parse(outSince);
  return Number.isFinite(t) && now - t >= LONG_OUT_HOURS * HOUR;
}

// Whole days out, for the note ("4 days"). Never less than 1.
export function daysOut(outSince: string, now: number = Date.now()): number {
  return Math.max(1, Math.floor((now - Date.parse(outSince)) / (24 * HOUR)));
}

// "Thursday, Oct 29", in restaurant time and always US English.
export function longDay(iso: string, tz = 'America/New_York'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(iso));
}

export interface NoteInput {
  vendor: string; // "Chesapeake Seafood Co."
  item: string; // "Pan-Roasted Halibut"
  restaurant: string; // "Main Street"
  outSince: string; // ISO time it was 86'd
  sender: string; // the manager's name, signed at the bottom
}

export interface Note {
  subject: string;
  body: string;
}

// The draft. Short, polite, one question. The internal 86 note ("Chesapeake
// shorted the order") is never quoted: it was written for the staff.
export function draftVendorNote(n: NoteInput, now: number = Date.now()): Note {
  const days = daysOut(n.outSince, now);
  const since = longDay(n.outSince);
  const subject = `${n.item}: out since ${since}`;
  const body = [
    `Hi ${n.vendor},`,
    '',
    `${n.item} has been off our menu at ${n.restaurant} since ${since} (${days} ${days === 1 ? 'day' : 'days'}), because we are out.`,
    '',
    'When can you deliver more? If it will take a while, is there a substitute you can send in the meantime?',
    '',
    'Thank you,',
    n.sender,
    n.restaurant,
  ].join('\n');
  return { subject, body };
}

// A plain email address, loosely: something@something.something, no spaces.
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

// The link that opens the manager's own mail app with the note filled in.
// Spaces become %20, never "+", which some mail apps would show as is.
export function mailtoLink(to: string, note: Note): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/%0A/g, '%0D%0A');
  return `mailto:${encodeURIComponent(to.trim()).replace(/%40/g, '@')}?subject=${enc(note.subject)}&body=${enc(note.body)}`;
}

// What the board and the email say once a note went out.
// "Vendor emailed by Priya M., Mon, Nov 2"
export function sentLine(by: string, at: string, tz = 'America/New_York'): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(at));
  return `Vendor emailed by ${by}, ${day}`;
}

// Who may send vendor notes: the owner anywhere, a manager at their own
// restaurant. Kitchen and floor staff see the 86, not the supplier's inbox.
export const vendorNoteGroupsFor = (restaurantId: string): string[] => [`${restaurantId}-manager`];

export function canSendVendorNote(groups: string[], restaurantId: string): boolean {
  return groups.includes('owner') || vendorNoteGroupsFor(restaurantId).some((g) => groups.includes(g));
}
