// Talks to the staging copy of 86 Board the way a phone does, but as several
// people at once: signs each one in with Cognito, then sends GraphQL and
// opens live subscriptions with that person's own token. Nothing here has
// AWS keys; it can only do what those logins can do.
import { Amplify } from 'aws-amplify';
import { fetchAuthSession, signIn, signOut } from 'aws-amplify/auth';

export interface Outputs {
  auth: { user_pool_id: string; user_pool_client_id: string; aws_region: string };
  data: { url: string };
  custom?: { reportUrl?: string };
}

export const STAGING_URL = (process.env.STAGING_URL ?? '').replace(/\/$/, '');
const PASSWORD = process.env.STAGING_STAFF_PASSWORD ?? '';

export function settingsProblem(): string | null {
  if (!STAGING_URL) return 'STAGING_URL is not set.';
  if (!PASSWORD) return 'STAGING_STAFF_PASSWORD is not set. Add the demo staff password from Load demo data on staging as a GitHub secret.';
  return null;
}

// The staging site publishes its own settings next to the page.
export async function loadOutputs(): Promise<Outputs> {
  const res = await fetch(`${STAGING_URL}/amplify_outputs.json?t=${Date.now()}`);
  if (!res.ok) throw new Error(`Could not read ${STAGING_URL}/amplify_outputs.json (${res.status}).`);
  const out = (await res.json()) as Outputs;
  Amplify.configure({ Auth: { Cognito: { userPoolId: out.auth.user_pool_id, userPoolClientId: out.auth.user_pool_client_id } } });
  return out;
}

// One sign-in per person; their access token is kept while it lasts (the
// pool gives five minutes), then they sign in again.
const tokens = new Map<string, { token: string; until: number }>();

export async function tokenFor(username: string): Promise<string> {
  const have = tokens.get(username);
  if (have && have.until - Date.now() > 60_000) return have.token;
  await signOut().catch(() => undefined);
  const res = await signIn({ username, password: PASSWORD });
  if (res.nextStep.signInStep !== 'DONE') throw new Error(`${username} could not sign in (${res.nextStep.signInStep}).`);
  const access = (await fetchAuthSession()).tokens?.accessToken;
  if (!access) throw new Error(`${username} signed in but got no token.`);
  const token = access.toString();
  tokens.set(username, { token, until: (access.payload.exp ?? 0) * 1000 });
  await signOut().catch(() => undefined);
  return token;
}

export interface GqlResult<T> {
  data: T | null;
  errors: { message: string; errorType?: string }[];
}

export async function gql<T = Record<string, unknown>>(out: Outputs, username: string, query: string, variables: Record<string, unknown> = {}): Promise<GqlResult<T>> {
  const res = await fetch(out.data.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await tokenFor(username) },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T | null; errors?: { message: string; errorType?: string }[] };
  return { data: body.data ?? null, errors: body.errors ?? [] };
}

// A live subscription over AppSync's real-time WebSocket, as one person.
export interface Live<T> {
  received: T[];
  errors: unknown[];
  close: () => void;
}

export async function subscribe<T>(out: Outputs, username: string, query: string, variables: Record<string, unknown>, field: string): Promise<Live<T>> {
  const token = await tokenFor(username);
  const host = new URL(out.data.url).host;
  const auth = { host, Authorization: token };
  const realtime = out.data.url.replace('https://', 'wss://').replace('appsync-api', 'appsync-realtime-api');
  const header = Buffer.from(JSON.stringify(auth)).toString('base64');
  const ws = new WebSocket(`${realtime}?header=${encodeURIComponent(header)}&payload=e30=`, ['graphql-ws']);
  const live: Live<T> = { received: [], errors: [], close: () => ws.close() };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${username}: the live subscription did not start within 15 seconds.`)), 15_000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'connection_init' }));
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${username}: could not open the live connection.`));
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as { type: string; payload?: { data?: Record<string, T>; errors?: unknown[] } };
      if (msg.type === 'connection_ack') {
        ws.send(JSON.stringify({ id: '1', type: 'start', payload: { data: JSON.stringify({ query, variables }), extensions: { authorization: auth } } }));
      } else if (msg.type === 'start_ack') {
        clearTimeout(timer);
        resolve();
      } else if (msg.type === 'data' && msg.payload?.data?.[field]) {
        live.received.push(msg.payload.data[field]);
      } else if (msg.type === 'error' || msg.type === 'connection_error') {
        live.errors.push(msg.payload ?? msg);
        clearTimeout(timer);
        reject(new Error(`${username}: the live subscription was refused: ${JSON.stringify(msg.payload ?? msg)}`));
      }
    };
  });
  return live;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Waits until check() is true or the time is up.
export async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await sleep(100);
  }
  return check();
}
