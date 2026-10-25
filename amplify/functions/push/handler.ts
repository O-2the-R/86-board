// Phone alerts.
//
// Called two ways:
//   - by the app, through pushPublicKey / subscribePush / unsubscribePush,
//     to register or remove a phone;
//   - by the MenuItem table's change stream, to send a push to every phone at
//     that restaurant when an item is 86'd, runs low, or comes back.
//
// The signing key pair (VAPID) is created on first use and kept in the
// PushKey table, so nothing has to be configured by hand.
import type { AppSyncIdentityCognito, AppSyncResolverEvent, DynamoDBStreamEvent } from 'aws-lambda';
import { env } from '$amplify/env/push';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import webpush from 'web-push';
import type { Schema } from '../../data/resource';
import { RESTAURANTS } from '../../../shared/sample-data';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const KEY_ID = 'vapid';
// Who to contact about this push sender. A URL is fine; it is the app itself.
const VAPID_SUBJECT = process.env.APP_URL || 'https://main.d2w35vo1xnmx2i.amplifyapp.com';

class Refused extends Error {}

function firstError(res: { errors?: { message: string }[] | undefined }, what: string) {
  if (res.errors?.length) throw new Error(`${what}: ${res.errors.map((e) => e.message).join('; ')}`);
}

// ---------- keys ----------

let keysCache: { publicKey: string; privateKey: string } | null = null;

async function vapidKeys() {
  if (keysCache) return keysCache;
  const got = await client.models.PushKey.get({ id: KEY_ID });
  firstError(got, 'Reading the alert key');
  if (got.data) {
    keysCache = { publicKey: got.data.publicKey, privateKey: got.data.privateKey };
    return keysCache;
  }
  const fresh = webpush.generateVAPIDKeys();
  const made = await client.models.PushKey.create({ id: KEY_ID, publicKey: fresh.publicKey, privateKey: fresh.privateKey });
  if (made.errors?.length) {
    // Two phones asked at the same moment; the other one won. Use its key.
    const again = await client.models.PushKey.get({ id: KEY_ID });
    firstError(again, 'Reading the alert key');
    if (!again.data) throw new Error('Could not create the alert key.');
    keysCache = { publicKey: again.data.publicKey, privateKey: again.data.privateKey };
    return keysCache;
  }
  keysCache = fresh;
  return keysCache;
}

// ---------- who is calling ----------

interface Actor {
  username: string;
  restaurantId: string; // 'all' for the owner
}

function actorFrom(event: AppSyncResolverEvent<unknown>): Actor {
  const id = event.identity as AppSyncIdentityCognito | null;
  if (!id || !('username' in id)) throw new Refused('Sign in first.');
  const groups = id.groups ?? [];
  if (groups.includes('owner')) return { username: id.username, restaurantId: 'all' };
  for (const g of groups) {
    const m = /^(.+)-(manager|kitchen|server|host)$/.exec(g);
    if (m) return { username: id.username, restaurantId: m[1] };
  }
  throw new Refused('This login is not attached to a restaurant.');
}

// ---------- app operations ----------

interface SubscribeArgs {
  endpoint: string;
  p256dh: string;
  auth: string;
  device?: string | null;
}
interface UnsubscribeArgs {
  endpoint: string;
}

const endpointId = (endpoint: string) => Buffer.from(endpoint).toString('base64url').slice(-120); // stable id per phone

async function subscribe(actor: Actor, args: SubscribeArgs) {
  if (!args.endpoint || !args.p256dh || !args.auth) throw new Refused('The phone did not send a complete subscription.');
  const id = endpointId(args.endpoint);
  const row = {
    id,
    username: actor.username,
    restaurantId: actor.restaurantId,
    endpoint: args.endpoint,
    p256dh: args.p256dh,
    auth: args.auth,
    device: args.device ?? undefined,
  };
  const existing = await client.models.PushSubscription.get({ id });
  const res = existing.data ? await client.models.PushSubscription.update(row) : await client.models.PushSubscription.create(row);
  firstError(res, 'Saving the alert subscription');
  return { ok: true, restaurantId: actor.restaurantId };
}

async function unsubscribe(actor: Actor, args: UnsubscribeArgs) {
  const id = endpointId(args.endpoint);
  const existing = await client.models.PushSubscription.get({ id });
  if (existing.data && existing.data.username === actor.username) {
    const res = await client.models.PushSubscription.delete({ id });
    firstError(res, 'Removing the alert subscription');
  }
  return { ok: true };
}

// ---------- sending ----------

// The handful of DynamoDB attribute shapes this table uses.
type Attr = { S?: string; N?: string; BOOL?: boolean; NULL?: boolean; L?: Attr[] };
type Image = Record<string, Attr>;

function str(img: Image | undefined, key: string): string | undefined {
  return img?.[key]?.S;
}
function num(img: Image | undefined, key: string): number | undefined {
  const n = img?.[key]?.N;
  return n === undefined ? undefined : Number(n);
}

interface Message {
  title: string;
  body: string;
  tag: string;
}

const names = new Map<string, string>(RESTAURANTS.map((r) => [r.id, r.name]));
async function restaurantName(id: string): Promise<string> {
  const known = names.get(id);
  if (known) return known;
  const got = await client.models.Restaurant.get({ id });
  const name = got.data?.name ?? id;
  names.set(id, name);
  return name;
}

// Decides whether a change deserves a buzz, and what it should say.
async function messageFor(oldImg: Image | undefined, newImg: Image | undefined): Promise<{ restaurantId: string; message: Message } | null> {
  if (!newImg) return null;
  const before = str(oldImg, 'status') ?? 'available';
  const after = str(newImg, 'status') ?? 'available';
  const beforeCount = num(oldImg, 'lowCount');
  const afterCount = num(newImg, 'lowCount');
  if (before === after && !(after === 'low' && beforeCount !== afterCount)) return null;

  const name = str(newImg, 'name') ?? 'An item';
  const restaurantId = str(newImg, 'restaurantId') ?? '';
  const where = await restaurantName(restaurantId);
  const by = str(newImg, 'markedBy');
  const tag = `item-${str(newImg, 'id') ?? name}`;

  if (after === 'out') {
    const note = str(newImg, 'note');
    const body = [where, note, by].filter(Boolean).join('. ');
    return { restaurantId, message: { title: `86'd: ${name}`, body, tag } };
  }
  if (after === 'low') {
    const count = afterCount ?? 0;
    const title = count > 0 ? `Running low: ${name}, last ${count}` : `Running low: ${name}`;
    const body = [where, by].filter(Boolean).join('. ');
    return { restaurantId, message: { title, body, tag } };
  }
  // back to available, from low or from 86'd
  return { restaurantId, message: { title: `Back on: ${name}`, body: where, tag } };
}

async function phonesFor(restaurantId: string) {
  const [here, owners] = await Promise.all([
    client.models.PushSubscription.listPushSubscriptionByRestaurantId({ restaurantId }, { limit: 500 }),
    client.models.PushSubscription.listPushSubscriptionByRestaurantId({ restaurantId: 'all' }, { limit: 100 }),
  ]);
  firstError(here, 'Listing phones');
  firstError(owners, 'Listing owner phones');
  return [...here.data, ...owners.data];
}

async function send(restaurantId: string, message: Message) {
  const keys = await vapidKeys();
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  const phones = await phonesFor(restaurantId);
  const payload = JSON.stringify({ ...message, url: '/' });
  let sent = 0;
  await Promise.all(
    phones.map(async (p) => {
      try {
        await webpush.sendNotification({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, payload, { TTL: 60 * 60, urgency: 'high' });
        sent += 1;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // The phone dropped its subscription; forget it.
          await client.models.PushSubscription.delete({ id: p.id });
        } else {
          console.error('push failed', p.id, code, e instanceof Error ? e.message : e);
        }
      }
    }),
  );
  console.log(`push: "${message.title}" to ${sent}/${phones.length} phones at ${restaurantId}`);
}

async function onStream(event: DynamoDBStreamEvent) {
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY') continue;
    const oldImg = record.dynamodb?.OldImage as Image | undefined;
    const newImg = record.dynamodb?.NewImage as Image | undefined;
    const change = await messageFor(oldImg, newImg);
    if (!change) continue;
    try {
      await send(change.restaurantId, change.message);
    } catch (e) {
      console.error('push: could not send', e instanceof Error ? e.message : e);
    }
    // A fresh 86 also goes to n8n, which emails it and logs it in the sheet.
    if (str(newImg, 'status') === 'out' && str(oldImg, 'status') !== 'out') {
      try {
        await notifyWebhook(await alertPayload(newImg!, false));
      } catch (e) {
        console.error('webhook: could not send', e instanceof Error ? e.message : e);
      }
    }
  }
  return { batchItemFailures: [] };
}

// ---------- n8n: the note on every 86 ----------

const TZ = 'America/New_York';
const INTEGRATION_ID = 'n8n';

const fmtDate = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtLong = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(iso));

function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function integration() {
  const got = await client.models.Integration.get({ id: INTEGRATION_ID });
  firstError(got, 'Reading the automation settings');
  return got.data;
}

// Everything n8n needs in one flat object: a subject and an HTML body ready
// for the Gmail node, and plain fields ready for one sheet row.
async function alertPayload(img: Image, test: boolean) {
  const item = str(img, 'name') ?? 'An item';
  const restaurantId = str(img, 'restaurantId') ?? '';
  const restaurant = await restaurantName(restaurantId);
  const at = str(img, 'outSince') ?? new Date().toISOString();
  const note = str(img, 'note') ?? '';
  const by = str(img, 'markedBy') ?? '';
  const category = str(img, 'category') ?? '';
  const vendor = str(img, 'vendor') ?? '';
  const subject = `${test ? '[Test] ' : ''}86'd at ${restaurant}: ${item}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#1d1a16">` +
    `<p style="margin:0 0 6px;font-size:13px;color:#6f685f">${esc(restaurant)} · ${esc(fmtLong(at))}, ${esc(fmtTime(at))}</p>` +
    `<p style="margin:0 0 12px;font-size:24px;font-weight:700"><span style="color:#d8382a">86'd</span> ${esc(item)}</p>` +
    (note ? `<p style="margin:0 0 6px">${esc(note)}</p>` : '') +
    (by ? `<p style="margin:0;color:#6f685f">Marked by ${esc(by)}</p>` : '') +
    (vendor ? `<p style="margin:12px 0 0;font-size:13px;color:#6f685f">Vendor: ${esc(vendor)}</p>` : '') +
    (test ? `<p style="margin:16px 0 0;font-size:13px;color:#6f685f">This is a test from the 86 Board Automations screen.</p>` : '') +
    `</div>`;
  return {
    kind: '86',
    test,
    restaurant,
    restaurantId,
    item,
    category,
    vendor,
    note,
    by,
    at,
    date: fmtDate(at),
    time: fmtTime(at),
    subject,
    html,
  };
}

async function notifyWebhook(payload: Record<string, unknown>): Promise<{ ok: boolean; status: number; detail?: string }> {
  const cfg = await integration();
  if (!cfg?.webhookUrl) return { ok: false, status: 0, detail: 'No n8n address saved yet.' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-86-key': cfg.key },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = (await res.text()).slice(0, 200);
    console.log(`webhook: ${payload.subject as string} -> ${res.status}`);
    return { ok: res.ok, status: res.status, detail: res.ok ? undefined : text };
  } catch (e) {
    return { ok: false, status: 0, detail: e instanceof Error ? e.message : 'Could not reach n8n.' };
  } finally {
    clearTimeout(timer);
  }
}

async function testWebhook(actor: Actor) {
  if (actor.restaurantId !== 'all') throw new Refused('Owner only.');
  const sample: Image = {
    name: { S: 'Pan-Roasted Halibut' },
    restaurantId: { S: 'main' },
    outSince: { S: new Date().toISOString() },
    note: { S: 'Test from the Automations screen' },
    markedBy: { S: actor.username },
    category: { S: 'Mains' },
    vendor: { S: 'Chesapeake Seafood Co.' },
  };
  const result = await notifyWebhook(await alertPayload(sample, true));
  const summary = result.ok ? `OK (${result.status})` : `Failed${result.status ? ` (${result.status})` : ''}: ${result.detail ?? ''}`.trim();
  const saved = await client.models.Integration.update({ id: INTEGRATION_ID, lastTestAt: new Date().toISOString(), lastTestResult: summary });
  firstError(saved, 'Saving the test result');
  return { ...result, summary };
}

// ---------- n8n: the morning report ----------

// "Yesterday" in restaurant time, as YYYY-MM-DD.
function yesterdayIn(tz: string): string {
  const now = new Date();
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = local.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

// The instant a local calendar day starts, found by asking the formatter what
// local time a candidate instant is and correcting. Handles DST days.
function startOfDay(y: number, m: number, d: number, tz: string): number {
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
function dayBounds(ymd: string, tz: string): { start: string; end: string } {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const start = startOfDay(y, m, d, tz);
  const end = startOfDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), tz);
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
}

interface ReportRow {
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

async function report(ymd: string) {
  const { start, end } = dayBounds(ymd, TZ);
  const restaurants = await client.models.Restaurant.list({ limit: 50 });
  firstError(restaurants, 'Listing restaurants');
  const sorted = restaurants.data.slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const now = Date.now();
  const groups: { name: string; count: number; items: ReportRow[] }[] = [];
  for (const r of sorted) {
    const res = await client.models.EightySixEvent.listEightySixEventByRestaurantIdAndStartedAt(
      { restaurantId: r.id, startedAt: { between: [start, end] } },
      { limit: 500 },
    );
    firstError(res, `Reading history for ${r.name}`);
    const items: ReportRow[] = res.data
      .slice()
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((e) => ({
        date: fmtDate(e.startedAt),
        restaurant: r.name,
        item: e.itemName,
        note: e.note ?? '',
        by: e.markedBy,
        outAt: fmtTime(e.startedAt),
        backAt: e.endedAt ? fmtTime(e.endedAt) : '',
        backBy: e.clearedBy ?? '',
        outFor: fmtDuration((e.endedAt ? Date.parse(e.endedAt) : now) - Date.parse(e.startedAt)),
        stillOut: !e.endedAt,
      }));
    groups.push({ name: r.name, count: items.length, items });
  }
  const rows = groups.flatMap((g) => g.items);
  const label = fmtLong(`${ymd}T12:00:00Z`);
  const subject = rows.length === 0 ? `86 Board: nothing was 86'd ${label}` : `86 Board: ${rows.length} ${rows.length === 1 ? 'item' : 'items'} 86'd ${label}`;
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:16px;color:#1d1a16">` +
    `<p style="margin:0 0 4px;font-size:13px;color:#6f685f">86 Board, daily digest</p>` +
    `<p style="margin:0 0 16px;font-size:22px;font-weight:700">${esc(label)}: ${rows.length === 0 ? "nothing was 86'd" : `${rows.length} ${rows.length === 1 ? 'item' : 'items'} 86'd`}</p>` +
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

// The Function URL. GET /report?date=YYYY-MM-DD (default: yesterday), with
// the Automations key in the x-86-key header.
interface UrlEvent {
  rawPath: string;
  headers: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext: { http: { method: string } };
}

async function onUrl(event: UrlEvent) {
  const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (event.requestContext.http.method !== 'GET') return reply(405, { error: 'GET only' });
  if (!/\/report\/?$/.test(event.rawPath)) return reply(404, { error: 'Try /report' });
  const cfg = await integration();
  const given = event.headers['x-86-key'] ?? event.headers['X-86-Key'] ?? '';
  if (!cfg?.key || !given || given !== cfg.key) return reply(401, { error: 'Wrong or missing x-86-key header.' });
  const wanted = event.queryStringParameters?.date;
  const ymd = wanted && /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? wanted : yesterdayIn(TZ);
  try {
    return reply(200, await report(ymd));
  } catch (e) {
    console.error('report failed', e instanceof Error ? e.message : e);
    return reply(500, { error: 'Could not build the report.' });
  }
}

// ---------- entry ----------

type AppEvent = AppSyncResolverEvent<Partial<SubscribeArgs & UnsubscribeArgs & { test: string }>>;

function operationOf(event: AppEvent): 'pushPublicKey' | 'subscribePush' | 'unsubscribePush' | 'testWebhook' {
  const named = (event as { info?: { fieldName?: string } }).info?.fieldName;
  if (named === 'pushPublicKey' || named === 'subscribePush' || named === 'unsubscribePush' || named === 'testWebhook') return named;
  const args = event.arguments ?? {};
  if (typeof args.test === 'string') return 'testWebhook';
  if (typeof args.p256dh === 'string') return 'subscribePush';
  if (typeof args.endpoint === 'string') return 'unsubscribePush';
  return 'pushPublicKey';
}

export const handler = async (event: DynamoDBStreamEvent | AppEvent | UrlEvent) => {
  if ('Records' in event) return onStream(event);
  if ('rawPath' in event) return onUrl(event);
  const actor = actorFrom(event);
  try {
    switch (operationOf(event)) {
      case 'pushPublicKey':
        return (await vapidKeys()).publicKey;
      case 'subscribePush':
        return await subscribe(actor, event.arguments as SubscribeArgs);
      case 'unsubscribePush':
        return await unsubscribe(actor, event.arguments as UnsubscribeArgs);
      case 'testWebhook':
        return await testWebhook(actor);
    }
  } catch (e) {
    if (e instanceof Refused) throw e;
    console.error(e);
    throw new Error(e instanceof Error ? e.message : 'Something went wrong.');
  }
};
