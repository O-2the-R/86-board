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
    const change = await messageFor(record.dynamodb?.OldImage as Image | undefined, record.dynamodb?.NewImage as Image | undefined);
    if (!change) continue;
    try {
      await send(change.restaurantId, change.message);
    } catch (e) {
      console.error('push: could not send', e instanceof Error ? e.message : e);
    }
  }
  return { batchItemFailures: [] };
}

// ---------- entry ----------

type AppEvent = AppSyncResolverEvent<Partial<SubscribeArgs & UnsubscribeArgs>>;

function operationOf(event: AppEvent): 'pushPublicKey' | 'subscribePush' | 'unsubscribePush' {
  const named = (event as { info?: { fieldName?: string } }).info?.fieldName;
  if (named === 'pushPublicKey' || named === 'subscribePush' || named === 'unsubscribePush') return named;
  const args = event.arguments ?? {};
  if (typeof args.p256dh === 'string') return 'subscribePush';
  if (typeof args.endpoint === 'string') return 'unsubscribePush';
  return 'pushPublicKey';
}

export const handler = async (event: DynamoDBStreamEvent | AppEvent) => {
  if ('Records' in event) return onStream(event);
  const actor = actorFrom(event);
  try {
    switch (operationOf(event)) {
      case 'pushPublicKey':
        return (await vapidKeys()).publicKey;
      case 'subscribePush':
        return await subscribe(actor, event.arguments as SubscribeArgs);
      case 'unsubscribePush':
        return await unsubscribe(actor, event.arguments as UnsubscribeArgs);
    }
  } catch (e) {
    if (e instanceof Refused) throw e;
    console.error(e);
    throw new Error(e instanceof Error ? e.message : 'Something went wrong.');
  }
};
