// The handler end to end, with a pretend database and a pretend AI in
// memory. No AWS: what is checked here is the handler's own decisions (who
// gets the lists, what is counted, what the AI is sent, what a refusal says).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string };
type Sent = { input: { modelId: string; system?: { text?: string }[]; messages: unknown[]; inferenceConfig: { maxTokens: number }; additionalModelRequestFields?: unknown } };

const fake = vi.hoisted(() => {
  const tables: Record<string, Map<string, Row>> = {};
  const table = (name: string) => (tables[name] ??= new Map());
  const RACE = { errors: [{ message: 'The conditional request failed (Service: DynamoDb)', errorType: 'DynamoDB:ConditionalCheckFailedException' }] };
  const model = (name: string) => ({
    get: async ({ id }: { id: string }) => ({ data: table(name).get(id) ?? null }),
    create: async (row: Row) => {
      if (table(name).has(row.id)) return { data: null, ...RACE };
      table(name).set(row.id, { ...row });
      return { data: row };
    },
    update: async (row: Row) => {
      const now = table(name).get(row.id);
      if (!now) return { data: null, errors: [{ message: 'No such row' }] };
      Object.assign(now, row);
      return { data: now };
    },
    delete: async ({ id }: { id: string }) => {
      table(name).delete(id);
      return { data: { id } };
    },
    list: async () => ({ data: [...table(name).values()] }),
  });
  const state = {
    tables,
    table,
    sent: [] as Sent[],
    answer: (_sent?: unknown): unknown => ({ output: { message: { content: [{ text: 'ALLERGIES: none | OTHER: none\n\n[[Tiramisu]] is on.' }] } }, stopReason: 'end_turn', usage: { inputTokens: 900, outputTokens: 20 } }),
    losesRace: 0, // how many times the next count loses to someone else
    client: {
      models: {
        AskLists: model('AskLists'),
        AskUsage: {
          ...model('AskUsage'),
          listAskUsageByRestaurantIdAndDay: async ({ restaurantId }: { restaurantId: string }) => ({
            data: [...table('AskUsage').values()].filter((r) => r.restaurantId === restaurantId).sort((a, b) => String(b.day).localeCompare(String(a.day))),
          }),
        },
        Restaurant: model('Restaurant'),
        Staff: model('Staff'),
        MenuItem: {
          listMenuItemByRestaurantId: async ({ restaurantId }: { restaurantId: string }) => ({ data: [...table('MenuItem').values()].filter((r) => r.restaurantId === restaurantId), nextToken: null }),
        },
      },
      graphql: async ({ variables }: { variables: { input: Row & { questions: number }; condition: { questions: { eq: number } } } }) => {
        const now = table('AskUsage').get(variables.input.id);
        if (state.losesRace > 0) {
          state.losesRace -= 1;
          if (now) now.questions = Number(now.questions) + 1; // someone else's question landed first
          throw RACE;
        }
        if (!now || now.questions !== variables.condition.questions.eq) throw RACE;
        Object.assign(now, variables.input);
        return { data: {} };
      },
    },
  };
  return state;
});

vi.mock('$amplify/env/assistant', () => ({ env: {} }));
vi.mock('@aws-amplify/backend/function/runtime', () => ({ getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }) }));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => undefined } }));
vi.mock('aws-amplify/data', () => ({ generateClient: () => fake.client }));
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class {
    send = async (command: Sent) => {
      fake.sent.push(command);
      return fake.answer(command);
    };
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
}));

const OWNER = { username: 'omar', groups: ['owner'] };
const SERVER = { username: 'sam.t', groups: ['main-server'] };
const MANAGER = { username: 'priya.m', groups: ['main-manager'] };
const WATER_SERVER = { username: 'zoe.f', groups: ['water-server'] };

type Handler = (event: never) => Promise<unknown>;

async function boot(settings: Record<string, string> = {}): Promise<Handler> {
  vi.resetModules();
  for (const key of ['ASK_SAMPLE_LISTS', 'ASK_DAILY_LIMIT', 'ASK_PERSON_DAILY_LIMIT']) delete process.env[key];
  process.env.ASK_MODEL_ID = 'us.test-model';
  Object.assign(process.env, settings);
  return (await import('./handler')).handler as unknown as Handler;
}

const call = (handler: Handler, who: { username: string; groups: string[] }, fieldName: string, args: Record<string, unknown>) => handler({ identity: who, info: { fieldName }, arguments: args } as never);
const ask = (handler: Handler, who: { username: string; groups: string[] }, restaurantId: string, question = 'Can I sell the Tiramisu?', known: string[] = []) =>
  call(handler, who, 'askAssistant', { restaurantId, turns: JSON.stringify([{ role: 'user', content: question }]), known }) as Promise<{ text: string; truncated: boolean }>;
const lists = (handler: Handler, who: { username: string; groups: string[] }, restaurantId: string) => call(handler, who, 'getAssistant', { restaurantId }) as Promise<{ name: string; venue: string; items: unknown[] } | null>;
const manage = (handler: Handler, who: { username: string; groups: string[] }, args: Record<string, unknown>) =>
  call(handler, who, 'manageAssistant', args) as Promise<{ ok: boolean; summary?: string; detail?: string; restaurants: Record<string, unknown>[] }>;
const refusal = async (p: Promise<unknown>): Promise<string> => p.then(() => 'answered', (e: Error) => e.message);

const FILE = JSON.stringify({
  name: 'Pepe',
  venue: 'a made-up trattoria for this test',
  items: [
    { name: 'Tiramisu', kind: 'food', section: 'Desserts', about: 'Mascarpone, espresso, cocoa', avoid: { egg: 'Raw egg in the cream.' } },
    { name: 'House Red', kind: 'wine', section: 'Red', prices: { glass: 12 } },
  ],
  docs: [{ title: 'Bar manual', text: 'Negroni: equal parts.' }],
});

beforeEach(() => {
  for (const t of Object.values(fake.tables)) t.clear();
  fake.sent.length = 0;
  fake.losesRace = 0;
  fake.answer = () => ({ output: { message: { content: [{ text: 'ALLERGIES: none | OTHER: none\n\n[[Tiramisu]] is on.' }] } }, stopReason: 'end_turn', usage: { inputTokens: 900, outputTokens: 20 } });
  for (const [i, id] of ['main', 'water', 'counter'].entries()) fake.table('Restaurant').set(id, { id, name: id, sortOrder: i });
  fake.table('Staff').set('omar', { id: 'omar', displayName: 'Omar' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('with no lists loaded (the live site until the owner loads some)', () => {
  it('shows nobody an Ask tab and never calls the AI', async () => {
    const handler = await boot();
    for (const who of [OWNER, SERVER, MANAGER]) expect(await lists(handler, who, 'main')).toBeNull();
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('Ask is not set up for this restaurant.');
    expect(await refusal(ask(handler, OWNER, 'main'))).toBe('Ask is not set up for this restaurant.');
    expect(fake.sent).toHaveLength(0);
    expect(fake.table('AskUsage').size).toBe(0);
  });
});

describe('the owner loads a restaurant\'s lists', () => {
  it('keeps them to the owner until the owner opens Ask to the staff there', async () => {
    const handler = await boot();
    const loaded = await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE });
    expect(loaded.restaurants[0]).toMatchObject({ restaurantId: 'main', loaded: true, sample: false, staffCanUse: false, name: 'Pepe', items: 2, notes: 1, loadedBy: 'Omar', questionsToday: 0, dailyLimit: 300 });

    expect((await lists(handler, OWNER, 'main'))?.name).toBe('Pepe');
    for (const who of [SERVER, MANAGER, WATER_SERVER]) expect(await lists(handler, who, 'main')).toBeNull();
    expect(await refusal(ask(handler, MANAGER, 'main'))).toBe('Ask is not set up for this restaurant.');
    expect(fake.sent).toHaveLength(0);

    await manage(handler, OWNER, { action: 'audience', restaurantId: 'main', staffCanUse: true });
    expect((await lists(handler, SERVER, 'main'))?.items).toHaveLength(2);
    expect(await lists(handler, WATER_SERVER, 'main')).toBeNull();
    expect(await refusal(ask(handler, WATER_SERVER, 'main'))).toBe('Ask is not set up for this restaurant.');
    expect((await ask(handler, SERVER, 'main')).text).toContain('[[Tiramisu]]');
  });

  it('keeps who can use it when new lists replace the old, and removes them for good', async () => {
    const handler = await boot();
    await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE });
    await manage(handler, OWNER, { action: 'audience', restaurantId: 'main', staffCanUse: true });
    const again = await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE.replace('Pepe', 'Pepe 2') });
    expect(again.restaurants[0]).toMatchObject({ staffCanUse: true, name: 'Pepe 2' });

    const gone = await manage(handler, OWNER, { action: 'remove', restaurantId: 'main' });
    expect(gone.restaurants[0]).toMatchObject({ loaded: false, staffCanUse: false });
    expect(await lists(handler, OWNER, 'main')).toBeNull();
    expect(fake.table('AskLists').size).toBe(0);
  });

  it('stores clean lists only, filed under the restaurant they were loaded for', async () => {
    const handler = await boot();
    await manage(handler, OWNER, { action: 'load', restaurantId: 'water', lists: JSON.stringify({ ...JSON.parse(FILE), restaurantId: 'main', extra: 'x' }) });
    const stored = JSON.parse(String(fake.table('AskLists').get('water')?.body));
    expect(stored.restaurantId).toBe('water');
    expect(stored.extra).toBeUndefined();
  });

  it('says what is wrong with a file instead of storing it', async () => {
    const handler = await boot();
    expect(await refusal(manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: 'name,kind' }))).toMatch(/not a lists file the app can read/);
    expect(await refusal(manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: '{"venue":"x","items":[{"name":"A","kind":"soup","section":"S"}]}' }))).toBe('A: "kind" must be food, drink or wine.');
    expect(await refusal(manage(handler, OWNER, { action: 'load', restaurantId: 'main' }))).toBe('Pick a lists file first.');
    expect(await refusal(manage(handler, OWNER, { action: 'load', restaurantId: 'nowhere', lists: FILE }))).toBe('Pick a restaurant.');
    expect(await refusal(manage(handler, OWNER, { action: 'audience', restaurantId: 'main', staffCanUse: true }))).toBe('Load lists for this restaurant first.');
    expect(fake.table('AskLists').size).toBe(0);
  });

  it('is for the owner only, even if a request gets past the API\'s own check', async () => {
    const handler = await boot();
    for (const action of ['status', 'test', 'load', 'audience', 'remove']) expect(await refusal(manage(handler, MANAGER, { action, restaurantId: 'main', lists: FILE, staffCanUse: true })), action).toBe('Owner only.');
    expect(fake.table('AskLists').size).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it('shows the owner every restaurant: loaded or not, who can use it, questions asked', async () => {
    const handler = await boot();
    await manage(handler, OWNER, { action: 'load', restaurantId: 'water', lists: FILE });
    await ask(handler, OWNER, 'water');
    const status = await manage(handler, OWNER, { action: 'status' });
    expect(status.restaurants.map((r) => [r.restaurantId, r.loaded, r.questionsToday, r.questions30])).toEqual([
      ['main', false, 0, 0],
      ['water', true, 1, 1],
      ['counter', false, 0, 0],
    ]);
  });
});

describe('a question', () => {
  const loadedAndOpen = async (settings: Record<string, string> = {}) => {
    const handler = await boot(settings);
    await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE });
    await manage(handler, OWNER, { action: 'audience', restaurantId: 'main', staffCanUse: true });
    return handler;
  };

  it('is answered from the stored lists and the board in the database, not from anything the phone says', async () => {
    const handler = await loadedAndOpen();
    fake.table('MenuItem').set('main-tiramisu', { id: 'main-tiramisu', restaurantId: 'main', name: 'Tiramisu', status: 'out' });
    fake.table('MenuItem').set('water-x', { id: 'water-x', restaurantId: 'water', name: 'House Red', status: 'out' });
    const res = await ask(handler, SERVER, 'main', 'Egg allergy. Tiramisu?', ['egg', 'made-up']);
    expect(res).toEqual({ text: 'ALLERGIES: none | OTHER: none\n\n[[Tiramisu]] is on.', truncated: false });
    const sent = fake.sent[0].input;
    expect(sent.modelId).toBe('us.test-model');
    expect(sent.system?.[0].text).toContain('You are Pepe, the bar and allergy helper for the floor staff at a made-up trattoria for this test');
    expect(sent.system?.[0].text).toContain('Tiramisu | Desserts | every menu | Mascarpone, espresso, cocoa | AVOID: egg');
    expect(sent.system?.[2].text).toBe("86 BOARD, right now\n86'D: Tiramisu\n\nKNOWN SO FAR, this guest cannot have: egg");
    expect(sent.messages).toEqual([{ role: 'user', content: [{ text: 'Egg allergy. Tiramisu?' }] }]);
    expect(sent.inferenceConfig.maxTokens).toBe(700);
    expect(sent.additionalModelRequestFields).toEqual({ thinking: { type: 'disabled' } });
  });

  it('asks the plain way when a model refuses the no-thinking setting, and remembers', async () => {
    const handler = await loadedAndOpen();
    const good = fake.answer;
    fake.answer = (sent) => {
      if ((sent as Sent).input.additionalModelRequestFields) throw Object.assign(new Error('thinking.type: disabled is not supported on this model'), { name: 'ValidationException' });
      return good();
    };
    expect((await ask(handler, SERVER, 'main')).text).toContain('Tiramisu');
    expect(fake.sent.map((s) => [Boolean(s.input.additionalModelRequestFields), s.input.inferenceConfig.maxTokens])).toEqual([
      [true, 700],
      [false, 2500],
    ]);
    await ask(handler, SERVER, 'main');
    expect(fake.sent).toHaveLength(3); // the second question went the plain way at once
    expect(fake.sent[2].input.additionalModelRequestFields).toBeUndefined();
  });

  it('does not take any other refusal for a reason to ask again and again', async () => {
    const handler = await loadedAndOpen();
    fake.answer = () => {
      throw Object.assign(new Error('The model returned the following errors: Input is too long'), { name: 'ValidationException' });
    };
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('The AI could not answer that. Send it again.');
    expect(fake.sent).toHaveLength(2); // with the setting, then once without
    fake.answer = () => ({ output: { message: { content: [{ text: 'ALLERGIES: none | OTHER: none\n\nYes.' }] } }, stopReason: 'end_turn' });
    await ask(handler, SERVER, 'main');
    expect(fake.sent[2].input.additionalModelRequestFields).toEqual({ thinking: { type: 'disabled' } }); // still the quick way
  });

  it('is counted for the restaurant and the login before the AI is called', async () => {
    const handler = await loadedAndOpen();
    await ask(handler, SERVER, 'main');
    await ask(handler, SERVER, 'main');
    await ask(handler, MANAGER, 'main');
    const rows = [...fake.table('AskUsage').values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ restaurantId: 'main', questions: 3 });
    expect(String(rows[0].id)).toMatch(/^main:\d{4}-\d{2}-\d{2}$/);
    expect(JSON.parse(String(rows[0].people))).toEqual({ 'sam.t': 2, 'priya.m': 1 });
  });

  it('stops at the daily limit without calling the AI again', async () => {
    const handler = await loadedAndOpen({ ASK_DAILY_LIMIT: '2', ASK_PERSON_DAILY_LIMIT: '5' });
    await ask(handler, SERVER, 'main');
    await ask(handler, MANAGER, 'main');
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('Ask has answered 2 questions here today, which is the daily limit. It starts again tomorrow.');
    expect(await refusal(ask(handler, OWNER, 'main'))).toMatch(/daily limit/);
    expect(fake.sent).toHaveLength(2);
  });

  it('stops one login at its own limit while the others carry on', async () => {
    const handler = await loadedAndOpen({ ASK_PERSON_DAILY_LIMIT: '1' });
    await ask(handler, SERVER, 'main');
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('You have asked 1 questions today, which is the daily limit for one login. It starts again tomorrow.');
    expect((await ask(handler, MANAGER, 'main')).text).toContain('Tiramisu');
  });

  it('counts every question even when two land at the same moment', async () => {
    const handler = await loadedAndOpen();
    await ask(handler, SERVER, 'main');
    fake.losesRace = 2; // twice, someone else's question is counted first
    await ask(handler, SERVER, 'main');
    expect(fake.table('AskUsage').values().next().value?.questions).toBe(4);
  });

  it('is refused before it is counted when the phone sends something that is not a question', async () => {
    const handler = await loadedAndOpen();
    expect(await refusal(call(handler, SERVER, 'askAssistant', { restaurantId: 'main', turns: '[]' }))).toBe('Type a question first.');
    expect(await refusal(ask(handler, SERVER, 'main', 'x'.repeat(1001)))).toMatch(/too long/);
    expect(fake.table('AskUsage').size).toBe(0);
    expect(fake.sent).toHaveLength(0);
  });

  it('says the answer was cut short when the AI ran out of room', async () => {
    const handler = await loadedAndOpen();
    fake.answer = () => ({ output: { message: { content: [{ text: 'ALLERGIES: none | OTHER: none\n\nThe steps are' }] } }, stopReason: 'max_tokens' });
    expect((await ask(handler, SERVER, 'main')).truncated).toBe(true);
  });

  it('tells staff in plain words when the AI is not switched on, is busy, or says nothing', async () => {
    const handler = await loadedAndOpen();
    const fail = (name: string) => () => {
      throw Object.assign(new Error('You don\'t have access to the model with the specified model ID.'), { name });
    };
    fake.answer = fail('AccessDeniedException');
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('The AI is not switched on for this app yet. The owner turns it on once, in AWS.');
    fake.answer = fail('ThrottlingException');
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('The AI is busy right now. Send it again in a moment.');
    fake.answer = () => ({ output: { message: { content: [] } }, stopReason: 'end_turn' });
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('The AI could not answer that. Send it again.');
  });

  it('never sends AWS\'s own error text or the lists back to a phone', async () => {
    const handler = await loadedAndOpen();
    fake.client.models.MenuItem.listMenuItemByRestaurantId = async () => {
      throw new Error('arn:aws:dynamodb:us-east-2:123456789012:table/MenuItem is unhappy');
    };
    // the board could not be read: the question is still answered
    expect((await ask(handler, SERVER, 'main')).text).toContain('Tiramisu');
    fake.table('AskLists').get('main')!.body = '{broken';
    expect(await lists(handler, OWNER, 'main')).toBeNull();
    const get = fake.client.models.AskLists.get;
    fake.client.models.AskLists.get = async () => ({ data: null, errors: [{ message: 'arn:aws:secret' }] }) as never;
    expect(await refusal(ask(handler, SERVER, 'main'))).toBe('Something went wrong. Try again.');
    fake.client.models.AskLists.get = get;
  });
});

describe('on staging, where a sample restaurant with no lists uses the made-up sample lists', () => {
  it('lets that restaurant\'s demo staff ask, and nobody from another restaurant', async () => {
    const handler = await boot({ ASK_SAMPLE_LISTS: 'on' });
    expect((await lists(handler, SERVER, 'main'))?.venue).toContain('sample restaurant');
    expect(await lists(handler, WATER_SERVER, 'main')).toBeNull();
    expect((await ask(handler, SERVER, 'main')).text).toContain('ALLERGIES:');
    const status = await manage(handler, OWNER, { action: 'status' });
    expect(status.restaurants[0]).toMatchObject({ restaurantId: 'main', loaded: true, sample: true, staffCanUse: true, questionsToday: 1 });
  });

  it('puts the owner\'s own lists first once they are loaded, private again', async () => {
    const handler = await boot({ ASK_SAMPLE_LISTS: 'on' });
    await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE });
    expect(await lists(handler, SERVER, 'main')).toBeNull();
    expect((await lists(handler, OWNER, 'main'))?.name).toBe('Pepe');
  });
});

describe('the owner\'s test of the AI', () => {
  it('says it is ready when the AI answers', async () => {
    const handler = await boot();
    fake.answer = () => ({ output: { message: { content: [{ text: 'ready' }] } }, stopReason: 'end_turn' });
    expect(await manage(handler, OWNER, { action: 'test' })).toMatchObject({ ok: true, summary: 'The AI answered ("ready"). Ask is ready.' });
    expect(fake.sent[0].input.inferenceConfig.maxTokens).toBe(16);
    expect(fake.sent[0].input.additionalModelRequestFields).toEqual({ thinking: { type: 'disabled' } });
  });

  it('says AWS refused when the model is not switched on, with AWS\'s own words for the owner', async () => {
    const handler = await boot();
    fake.answer = () => {
      throw Object.assign(new Error('Model access is denied.'), { name: 'AccessDeniedException' });
    };
    expect(await manage(handler, OWNER, { action: 'test' })).toMatchObject({
      ok: false,
      problem: 'off',
      summary: 'AWS refused the call (AccessDeniedException). The AI is not switched on for this AWS account yet.',
      detail: 'Model access is denied.',
    });
  });

  it('says so when the fault is the app\'s own permission, which is not the owner\'s to fix in AWS', async () => {
    const handler = await boot();
    fake.answer = () => {
      throw Object.assign(new Error('User: arn:aws:sts::1:assumed-role/a/b is not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2::foundation-model/x'), { name: 'AccessDeniedException' });
    };
    const res = (await manage(handler, OWNER, { action: 'test' })) as unknown as { ok: boolean; problem: string; summary: string };
    expect(res).toMatchObject({ ok: false, problem: 'denied' });
    expect(res.summary).toContain("This app's own permission does not cover the model");
    await manage(handler, OWNER, { action: 'load', restaurantId: 'main', lists: FILE });
    expect(await refusal(ask(handler, OWNER, 'main'))).toBe('The AI is not available: this app is not allowed to call it. Tell the owner.');
  });
});
