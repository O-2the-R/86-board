// The morning report, as plain functions with no AWS in them so they can be
// tested in milliseconds: restaurant-time day boundaries (DST included),
// durations, and the email a manager reads at 9 AM.

export const TZ = 'America/New_York';

export const fmtDate = (iso: string, tz = TZ): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
export const fmtTime = (iso: string, tz = TZ): string => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtLong = (iso: string, tz = TZ): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(iso));

// 2h 10m, 45m, 3d 4h
export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "Yesterday" in restaurant time, as YYYY-MM-DD.
export function yesterdayIn(tz: string, now: Date = new Date()): string {
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = local.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

// The instant a local calendar day starts, found by asking the formatter what
// local time a candidate instant is and correcting. Handles DST days.
export function startOfDay(y: number, m: number, d: number, tz: string): number {
  let t = Date.UTC(y, m - 1, d, 0);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(t));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    const localHour = get('hour') % 24;
    const dayDiff = Math.round((Date.UTC(get('year'), get('month') - 1, get('day')) - Date.UTC(y, m - 1, d)) / 86_400_000);
    const diffHours = dayDiff * 24 + localHour;
    if (diffHours === 0) break;
    t -= diffHours * 3_600_000;
  }
  return t;
}

// The UTC start and end of a local calendar day (end = start of the next day,
// so a 23- or 25-hour DST day is still covered exactly).
export function dayBounds(ymd: string, tz: string): { start: string; end: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const start = startOfDay(y, m, d, tz);
  const end = startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

// What the report needs from one history entry.
export interface ReportEvent {
  itemName: string;
  startedAt: string;
  endedAt?: string | null;
  note?: string | null;
  markedBy: string;
  clearedBy?: string | null;
}

export interface ReportRow {
  date: string;
  restaurant: string;
  item: string;
  note: string;
  by: string;
  outAt: string;
  backAt: string;
  backBy: string;
  outFor: string;
  stillOut: boolean;
}

export interface ReportGroup {
  name: string;
  count: number;
  items: ReportRow[];
}

export interface Report {
  date: string;
  label: string;
  total: number;
  restaurants: ReportGroup[];
  rows: ReportRow[];
  subject: string;
  html: string;
}

// Turns the day's events, already fetched per restaurant, into the report:
// flat rows for the sheet, a subject and an HTML body for the email.
export function buildReport(ymd: string, perRestaurant: { name: string; events: ReportEvent[] }[], now: number = Date.now(), tz = TZ): Report {
  const groups: ReportGroup[] = perRestaurant.map((r) => {
    const items: ReportRow[] = r.events
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((e) => ({
        date: fmtDate(e.startedAt, tz),
        restaurant: r.name,
        item: e.itemName,
        note: e.note ?? '',
        by: e.markedBy,
        outAt: fmtTime(e.startedAt, tz),
        backAt: e.endedAt ? fmtTime(e.endedAt, tz) : '',
        backBy: e.clearedBy ?? '',
        outFor: fmtDuration((e.endedAt ? Date.parse(e.endedAt) : now) - Date.parse(e.startedAt)),
        stillOut: !e.endedAt,
      }));
    return { name: r.name, count: items.length, items };
  });
  const rows = groups.flatMap((g) => g.items);
  const label = fmtLong(`${ymd}T12:00:00Z`, tz);
  const count = rows.length === 0 ? "nothing was 86'd" : `${rows.length} ${rows.length === 1 ? 'item' : 'items'} 86'd`;
  const subject = `86 Board: ${count} ${label}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#1d1a16">` +
    `<p style="margin:0 0 4px;font-size:13px;color:#6f685f">86 Board, daily digest</p>` +
    `<p style="margin:0 0 16px;font-size:22px;font-weight:700">${esc(label)}: ${esc(count)}</p>` +
    groups
      .map(
        (g) =>
          `<p style="margin:14px 0 6px;font-size:13px;font-weight:700;color:#b8780f;text-transform:uppercase;letter-spacing:.04em">${esc(g.name)} · ${g.count}</p>` +
          (g.items.length === 0
            ? `<p style="margin:0;color:#6f685f">Nothing 86'd.</p>`
            : `<table style="border-collapse:collapse;width:100%;max-width:560px">` +
              g.items
                .map(
                  (i) =>
                    `<tr><td style="padding:6px 8px 6px 0;border-bottom:1px solid #e6e1d8;vertical-align:top"><b>${esc(i.item)}</b>${i.note ? `<br><span style="color:#6f685f">${esc(i.note)}</span>` : ''}<br><span style="font-size:13px;color:#6f685f">${esc(i.by)}${i.backBy ? `, back on by ${esc(i.backBy)}` : ''}</span></td>` +
                    `<td style="padding:6px 0;border-bottom:1px solid #e6e1d8;text-align:right;white-space:nowrap;vertical-align:top">${esc(i.outAt)}${i.backAt ? ` – ${esc(i.backAt)}` : ''}<br><span style="font-size:13px;color:${i.stillOut ? '#d8382a' : '#6f685f'}">${i.stillOut ? 'still out' : esc(i.outFor)}</span></td></tr>`,
                )
                .join('') +
              `</table>`),
      )
      .join('') +
    `</div>`;
  return { date: ymd, label, total: rows.length, restaurants: groups, rows, subject, html };
}

// The handful of DynamoDB attribute shapes the stream hands us.
export type Attr = { S?: string; N?: string; BOOL?: boolean; NULL?: boolean; L?: Attr[] };
export type Image = Record<string, Attr>;

export const str = (img: Image | undefined, key: string): string | undefined => img?.[key]?.S;
export const num = (img: Image | undefined, key: string): number | undefined => {
  const n = img?.[key]?.N;
  return n === undefined ? undefined : Number(n);
};

export type ChangeKind = 'out' | 'low' | 'back';

export interface Change {
  kind: ChangeKind;
  restaurantId: string;
  itemId: string;
  name: string;
  note?: string;
  by?: string;
  count?: number;
}

// Decides whether a change to a menu item deserves a buzz, and which kind.
// Returns null when nothing a person cares about changed.
export function changeOf(oldImg: Image | undefined, newImg: Image | undefined): Change | null {
  if (!newImg) return null;
  const before = str(oldImg, 'status') ?? 'available';
  const after = str(newImg, 'status') ?? 'available';
  const beforeCount = num(oldImg, 'lowCount');
  const afterCount = num(newImg, 'lowCount');
  if (before === after && !(after === 'low' && beforeCount !== afterCount)) return null;
  const base = {
    restaurantId: str(newImg, 'restaurantId') ?? '',
    itemId: str(newImg, 'id') ?? '',
    name: str(newImg, 'name') ?? 'An item',
    by: str(newImg, 'markedBy'),
  };
  if (after === 'out') return { kind: 'out', ...base, note: str(newImg, 'note') };
  if (after === 'low') return { kind: 'low', ...base, count: afterCount ?? 0 };
  return { kind: 'back', ...base };
}

// The words on the phone for a change.
export function pushMessage(change: Change, where: string): { title: string; body: string; tag: string } {
  const tag = `item-${change.itemId || change.name}`;
  if (change.kind === 'out') return { title: `86'd: ${change.name}`, body: [where, change.note, change.by].filter(Boolean).join('. '), tag };
  if (change.kind === 'low') {
    const title = change.count && change.count > 0 ? `Running low: ${change.name}, last ${change.count}` : `Running low: ${change.name}`;
    return { title, body: [where, change.by].filter(Boolean).join('. '), tag };
  }
  return { title: `Back on: ${change.name}`, body: where, tag };
}
