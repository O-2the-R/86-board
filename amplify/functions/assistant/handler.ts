// Runs behind getAssistant, askAssistant and manageAssistant. It is the only
// code that reads a restaurant's stored lists and the only code that talks to
// the AI, so "who may see the lists", "who may ask" and "how many questions a
// day" are checked here, on the server, never in the app.
//
// What the AI reads is built here too: the stored lists and the 86 board as
// it is in the database right now. The phone sends only the chat.
import type { AppSyncIdentityCognito, AppSyncResolverEvent } from 'aws-lambda';
import { env } from '$amplify/env/assistant';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { BedrockRuntimeClient, ConverseCommand, type ConverseCommandInput, type ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import type { Schema } from '../../data/resource';
import type { AssistantCatalog, BoardNow } from '../../../shared/assistant/catalog';
import { NOTHING_OUT, boardNow } from '../../../shared/assistant/catalog';
import { BadLists, cleanCatalog, countsOf, parseLists } from '../../../shared/assistant/load';
import { SAMPLE_CATALOGS } from '../../../shared/assistant/sample';
import { thinksByDefault } from '../../../shared/assistant/model';
import { conditionFailed, type GqlErrors } from '../../../shared/conditional';
import { TZ } from '../push/report';
import {
  DEFAULT_LIMITS,
  NOT_SET_UP,
  Refused,
  SAY,
  actorFromIdentity,
  checkLimits,
  cleanKnown,
  cleanTurns,
  converseInput,
  dateIn,
  dayIn,
  limitFrom,
  mayUse,
  peopleFrom,
  problemOf,
  thinkingOff,
  usageIdFor,
  withRoomToThink,
  type Actor,
  type Limits,
} from './rules';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();
const bedrock = new BedrockRuntimeClient({ maxAttempts: 3, retryMode: 'adaptive' });

// All four are set in backend.ts.
const MODEL_ID = process.env.ASK_MODEL_ID ?? '';
// Staging only: a sample restaurant with no lists of its own answers from the
// made-up sample lists, so the staging test can ask a real question.
const SAMPLE_LISTS = process.env.ASK_SAMPLE_LISTS === 'on';
const LIMITS: Limits = {
  restaurant: limitFrom(process.env.ASK_DAILY_LIMIT, DEFAULT_LIMITS.restaurant),
  person: limitFrom(process.env.ASK_PERSON_DAILY_LIMIT, DEFAULT_LIMITS.person),
};

function firstError(res: { errors?: { message: string }[] | undefined }, what: string) {
  if (res.errors?.length) throw new Error(`${what}: ${res.errors.map((e) => e.message).join('; ')}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- the AI ----------

// A Claude 5 model thinks before it answers unless told not to. Earlier
// models answer the quick way as they are, so they are asked as they are.
const TOLD_NOT_TO_THINK = thinksByDefault(MODEL_ID);

// Set once a model has refused the "no thinking" setting but answered
// without it. From then on this copy of the function asks the plain way.
let askPlainly = false;

// One call to the AI: without thinking where the model would think, the
// plain way where it does not or will not. Any other failure is the caller's
// to explain.
async function converse(input: ConverseCommandInput & { inferenceConfig: { maxTokens: number } }, ms: number): Promise<ConverseCommandOutput> {
  const send = (request: ConverseCommandInput) => bedrock.send(new ConverseCommand(request), { abortSignal: AbortSignal.timeout(ms) });
  if (!TOLD_NOT_TO_THINK) return send(input);
  if (!askPlainly) {
    try {
      return await send(thinkingOff(input));
    } catch (e) {
      if ((e as { name?: string }).name !== 'ValidationException') throw e;
      console.error('The model refused the request with thinking off; asking again without that setting', { model: input.modelId, message: e instanceof Error ? e.message : String(e) });
    }
  }
  const res = await send(withRoomToThink(input));
  askPlainly = true;
  return res;
}

const textOf = (res: ConverseCommandOutput): string =>
  (res.output?.message?.content ?? [])
    .map((block) => block.text ?? '')
    .join('')
    .trim();

// ---------- the stored lists ----------

type ListsRow = Schema['AskLists']['type'];

interface Stored {
  catalog: AssistantCatalog;
  staffCanUse: boolean;
  sample: boolean; // the made-up sample lists, not a stored row
  row: ListsRow | null;
}

async function listsFor(restaurantId: string): Promise<Stored | null> {
  if (!restaurantId) return null;
  const got = await client.models.AskLists.get({ id: restaurantId });
  firstError(got, 'Reading the lists');
  const row = got.data;
  if (row) {
    try {
      const catalog = JSON.parse(row.body) as AssistantCatalog;
      if (!Array.isArray(catalog.items) || !Array.isArray(catalog.docs)) throw new Error('not lists');
      return { catalog: { ...catalog, restaurantId }, staffCanUse: row.staffCanUse, sample: false, row };
    } catch (e) {
      console.error(`The stored lists for ${restaurantId} cannot be read`, e);
      return null;
    }
  }
  const sample = SAMPLE_LISTS ? SAMPLE_CATALOGS[restaurantId] : undefined;
  return sample ? { catalog: sample, staffCanUse: true, sample: true, row: null } : null;
}

// The 86 board as the database has it this second. If it cannot be read the
// question is still answered: the app stamps 86'd items itself, from the
// phone's own live board.
async function boardFor(restaurantId: string): Promise<BoardNow> {
  try {
    const rows: { name: string; status: string; lowCount?: number }[] = [];
    let nextToken: string | null | undefined;
    do {
      const res = await client.models.MenuItem.listMenuItemByRestaurantId({ restaurantId }, { limit: 500, nextToken: nextToken ?? undefined });
      firstError(res, 'Reading the board');
      for (const i of res.data) rows.push({ name: i.name, status: i.status, lowCount: i.lowCount ?? undefined });
      nextToken = res.nextToken;
    } while (nextToken);
    return boardNow(rows);
  } catch (e) {
    console.error(`The board for ${restaurantId} could not be read`, e);
    return NOTHING_OUT;
  }
}

// ---------- the daily count ----------

// One row per restaurant and day. A question is counted before the AI is
// called, and the count only moves if nobody else moved it in between, so
// many questions at the same moment cannot slip past the limit together.
const BUMP = /* GraphQL */ `
  mutation BumpAskUsage($input: UpdateAskUsageInput!, $condition: ModelAskUsageConditionInput) {
    updateAskUsage(input: $input, condition: $condition) {
      id
      questions
    }
  }
`;

// someone else's question was counted first: read the count again
const lostTheRace = conditionFailed;

async function countQuestion(restaurantId: string, day: string, username: string): Promise<void> {
  const id = usageIdFor(restaurantId, day);
  for (let attempt = 0; attempt < 6; attempt++) {
    const got = await client.models.AskUsage.get({ id });
    firstError(got, "Reading today's count");
    const row = got.data;
    const people = peopleFrom(row?.people);
    checkLimits({ questions: row?.questions ?? 0, people }, username, LIMITS);
    people[username] = (people[username] ?? 0) + 1;

    let errors: GqlErrors = [];
    if (!row) {
      // create refuses when the row already exists, which is the same race
      const made = await client.models.AskUsage.create({ id, restaurantId, day, questions: 1, people: JSON.stringify(people) });
      errors = made.errors ?? [];
    } else {
      try {
        const res = (await client.graphql({
          query: BUMP,
          variables: { input: { id, questions: row.questions + 1, people: JSON.stringify(people) }, condition: { questions: { eq: row.questions } } },
        })) as { errors?: GqlErrors };
        errors = res.errors ?? [];
      } catch (e) {
        errors = (e as { errors?: GqlErrors }).errors ?? [{ message: e instanceof Error ? e.message : String(e) }];
      }
    }
    if (errors.length === 0) return;
    if (!lostTheRace(errors)) throw new Error(`Counting the question: ${errors.map((e) => e.message).join('; ')}`);
    await sleep(20 + Math.random() * 60 * (attempt + 1));
  }
  throw new Refused(SAY.busy);
}

async function questionsAsked(restaurantId: string, today: string): Promise<{ today: number; last30: number }> {
  const res = await client.models.AskUsage.listAskUsageByRestaurantIdAndDay({ restaurantId }, { sortDirection: 'DESC', limit: 30 });
  firstError(res, 'Reading the question counts');
  const cutoff = dayIn(TZ, new Date(Date.now() - 29 * 86_400_000));
  let last30 = 0;
  let onDay = 0;
  for (const r of res.data) {
    if (r.day >= cutoff) last30 += r.questions;
    if (r.day === today) onDay = r.questions;
  }
  return { today: onDay, last30 };
}

// ---------- getAssistant ----------

// The lists for the people allowed to use Ask at this restaurant. Null for
// everyone else, and when there are no lists: the app then shows no Ask tab.
async function getAssistant(actor: Actor, args: { restaurantId?: string | null }) {
  const restaurantId = String(args.restaurantId ?? '');
  const stored = await listsFor(restaurantId);
  if (!stored || !mayUse(actor, restaurantId, stored.staffCanUse)) return null;
  return stored.catalog;
}

// ---------- askAssistant ----------

interface AskArgs {
  restaurantId?: string | null;
  turns?: string | null;
  known?: (string | null)[] | null;
}

async function askAssistant(actor: Actor, args: AskArgs) {
  const restaurantId = String(args.restaurantId ?? '');
  const stored = await listsFor(restaurantId);
  // the same answer whether there are no lists or this person may not use them
  if (!stored || !mayUse(actor, restaurantId, stored.staffCanUse)) throw new Refused(NOT_SET_UP);
  const turns = cleanTurns(args.turns);
  const known = cleanKnown(args.known);

  const [now] = await Promise.all([boardFor(restaurantId), countQuestion(restaurantId, dayIn(TZ), actor.username)]);

  const started = Date.now();
  let res: ConverseCommandOutput;
  try {
    res = await converse(converseInput(MODEL_ID, stored.catalog, known, now, turns), 12_000);
  } catch (e) {
    const name = (e as { name?: string }).name;
    const message = e instanceof Error ? e.message : String(e);
    console.error('The AI call failed', { name, message, restaurantId, model: MODEL_ID });
    throw new Refused(SAY[problemOf(name, message)]);
  }
  const text = textOf(res);
  const u = res.usage;
  // Numbers only, never the chat itself: a question can name a guest's allergy.
  console.log(
    JSON.stringify({ ask: restaurantId, ms: Date.now() - started, stop: res.stopReason, in: u?.inputTokens, out: u?.outputTokens, cacheRead: u?.cacheReadInputTokens, cacheWrite: u?.cacheWriteInputTokens }),
  );
  if (!text) throw new Refused(SAY.other);
  return { text, truncated: res.stopReason === 'max_tokens' };
}

// ---------- manageAssistant (owner only) ----------

interface ManageArgs {
  action?: string | null;
  restaurantId?: string | null;
  lists?: string | null;
  staffCanUse?: boolean | null;
}

async function setupOf(restaurantId: string) {
  const [stored, asked] = await Promise.all([listsFor(restaurantId), questionsAsked(restaurantId, dayIn(TZ))]);
  const counts = stored ? countsOf(stored.catalog) : { items: 0, notes: 0 };
  return {
    restaurantId,
    loaded: stored !== null,
    sample: stored?.sample ?? false,
    staffCanUse: stored?.staffCanUse ?? false,
    name: stored?.catalog.name ?? null,
    asOf: stored?.catalog.asOf ?? null,
    items: counts.items,
    notes: counts.notes,
    loadedAt: stored?.row?.loadedAt ?? null,
    loadedBy: stored?.row?.loadedBy ?? null,
    questionsToday: asked.today,
    questions30: asked.last30,
    dailyLimit: LIMITS.restaurant,
  };
}

async function allRestaurantIds(): Promise<string[]> {
  const res = await client.models.Restaurant.list({ limit: 100 });
  firstError(res, 'Listing restaurants');
  return res.data
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((r) => r.id);
}

async function displayNameOf(username: string): Promise<string> {
  const got = await client.models.Staff.get({ id: username });
  return got.data?.displayName ?? username;
}

// One tiny question, so the owner can see whether AWS lets this app call the AI.
async function testAi() {
  try {
    const res = await converse({ modelId: MODEL_ID, messages: [{ role: 'user', content: [{ text: 'Reply with one word: ready' }] }], inferenceConfig: { maxTokens: 16 } }, 10_000);
    const said = textOf(res);
    return { ok: true, model: MODEL_ID, summary: `The AI answered${said ? ` ("${said.slice(0, 40)}")` : ''}. Ask is ready.` };
  } catch (e) {
    const name = (e as { name?: string }).name ?? 'Error';
    const message = e instanceof Error ? e.message : String(e);
    console.error('The AI test failed', { name, message, model: MODEL_ID });
    const problem = problemOf(name, message);
    const summary = {
      off: `AWS refused the call (${name}). The AI is not switched on for this AWS account yet.`,
      closed: `AWS refused the call (${name}). AWS has not opened this model for your AWS account. No setting of yours changes that.`,
      denied: `AWS refused the call (${name}). This app's own permission does not cover the model. That is a fault in the app's setup, not a step for you.`,
      busy: `The AI did not answer in time (${name}). Try again in a minute.`,
      other: `The AI call failed (${name}).`,
    }[problem];
    return { ok: false, problem, model: MODEL_ID, summary, detail: message.slice(0, 300) };
  }
}

async function manageAssistant(actor: Actor, args: ManageArgs) {
  if (!actor.isOwner) throw new Refused('Owner only.');
  const action = args.action ?? '';
  if (action === 'status') return { ok: true, model: MODEL_ID, restaurants: await Promise.all((await allRestaurantIds()).map(setupOf)) };
  if (action === 'test') return testAi();

  const restaurantId = (args.restaurantId ?? '').trim();
  const restaurant = restaurantId ? await client.models.Restaurant.get({ id: restaurantId }) : null;
  if (!restaurant?.data) throw new Refused('Pick a restaurant.');
  const got = await client.models.AskLists.get({ id: restaurantId });
  firstError(got, 'Reading the lists');

  if (action === 'load') {
    if (typeof args.lists !== 'string' || !args.lists.trim()) throw new Refused('Pick a lists file first.');
    let catalog: AssistantCatalog;
    try {
      catalog = cleanCatalog(restaurantId, parseLists(args.lists), dateIn(TZ));
    } catch (e) {
      if (e instanceof BadLists) throw new Refused(e.message);
      throw e;
    }
    const counts = countsOf(catalog);
    const fields = { restaurantId, body: JSON.stringify(catalog), items: counts.items, notes: counts.notes, loadedAt: new Date().toISOString(), loadedBy: await displayNameOf(actor.username) };
    // New lists keep whoever could use Ask before. The first load is the owner only.
    const saved = got.data ? await client.models.AskLists.update({ id: restaurantId, ...fields }) : await client.models.AskLists.create({ id: restaurantId, ...fields, staffCanUse: false });
    firstError(saved, 'Saving the lists');
  } else if (action === 'audience') {
    if (typeof args.staffCanUse !== 'boolean') throw new Refused('Say who can use Ask: the owner only, or the staff too.');
    if (!got.data) throw new Refused('Load lists for this restaurant first.');
    firstError(await client.models.AskLists.update({ id: restaurantId, staffCanUse: args.staffCanUse }), 'Saving who can use Ask');
  } else if (action === 'remove') {
    if (got.data) firstError(await client.models.AskLists.delete({ id: restaurantId }), 'Removing the lists');
  } else {
    throw new Refused('Unknown action.');
  }
  return { ok: true, model: MODEL_ID, restaurants: [await setupOf(restaurantId)] };
}

// ---------- entry ----------

type AppEvent = AppSyncResolverEvent<Partial<AskArgs & ManageArgs>>;
type Operation = 'getAssistant' | 'askAssistant' | 'manageAssistant';
const OPERATIONS: Operation[] = ['getAssistant', 'askAssistant', 'manageAssistant'];

// The API does not always pass event.info, so the operation can also be told
// apart by its arguments: manageAssistant has `action`, askAssistant `turns`.
function operationOf(event: AppEvent): Operation {
  const named = (event as { info?: { fieldName?: string } }).info?.fieldName as Operation | undefined;
  if (named && OPERATIONS.includes(named)) return named;
  const args = event.arguments ?? {};
  if (typeof args.action === 'string') return 'manageAssistant';
  if (typeof args.turns === 'string') return 'askAssistant';
  return 'getAssistant';
}

export const handler = async (event: AppEvent) => {
  const identity = event.identity as AppSyncIdentityCognito | null;
  const actor = actorFromIdentity(identity && 'username' in identity ? { username: identity.username, groups: identity.groups } : null);
  try {
    switch (operationOf(event)) {
      case 'getAssistant':
        return await getAssistant(actor, event.arguments ?? {});
      case 'askAssistant':
        return await askAssistant(actor, event.arguments ?? {});
      case 'manageAssistant':
        return await manageAssistant(actor, event.arguments ?? {});
    }
  } catch (e) {
    if (e instanceof Refused) throw e;
    // Details stay in the log. Nothing about the lists or AWS goes back to a phone.
    console.error(e);
    throw new Error('Something went wrong. Try again.');
  }
};
