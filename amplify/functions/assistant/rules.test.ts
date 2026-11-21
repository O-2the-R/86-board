import { describe, expect, it } from 'vitest';
import { NOTHING_OUT, boardNow } from '../../../shared/assistant/catalog';
import { SAMPLE_CATALOGS } from '../../../shared/assistant/sample';
import {
  DEFAULT_LIMITS,
  INPUT,
  MAX_ANSWER_TOKENS,
  MAX_TOKENS_WITH_THINKING,
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
} from './rules';

const owner = actorFromIdentity({ username: 'omar', groups: ['owner'] });
const server = actorFromIdentity({ username: 'sam.t', groups: ['main-server'] });
const manager = actorFromIdentity({ username: 'priya.m', groups: ['main-manager'] });
const said = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof Refused) return e.message;
    throw e;
  }
  return 'allowed';
};

describe('who may use Ask', () => {
  it('needs a login', () => {
    expect(said(() => actorFromIdentity(null))).toBe('Sign in first.');
    expect(said(() => actorFromIdentity({ groups: ['owner'] }))).toBe('Sign in first.');
  });

  it('lets the owner use it anywhere, open to staff or not', () => {
    expect(mayUse(owner, 'main', false)).toBe(true);
    expect(mayUse(owner, 'water', true)).toBe(true);
  });

  it('keeps staff out until the owner opens it to them, managers included', () => {
    expect(mayUse(server, 'main', false)).toBe(false);
    expect(mayUse(manager, 'main', false)).toBe(false);
    expect(mayUse(server, 'main', true)).toBe(true);
    expect(mayUse(manager, 'main', true)).toBe(true);
  });

  it("never shows staff another restaurant's Ask", () => {
    expect(mayUse(server, 'water', true)).toBe(false);
    expect(mayUse(manager, 'counter', true)).toBe(false);
    expect(mayUse(actorFromIdentity({ username: 'x', groups: [] }), 'main', true)).toBe(false);
  });
});

describe('what a phone may send', () => {
  const q = (content: string) => ({ role: 'user', content });
  const a = (content: string) => ({ role: 'assistant', content });

  it('takes the chat as JSON text and sends on the last ten messages, starting on a question', () => {
    const chat = Array.from({ length: 13 }, (_, i) => (i % 2 === 0 ? q('q' + i) : a('a' + i)));
    const turns = cleanTurns(JSON.stringify(chat));
    expect(turns.map((t) => t.content)).toEqual(['q4', 'a5', 'q6', 'a7', 'q8', 'a9', 'q10', 'a11', 'q12']);
    expect(turns[turns.length - 1].role).toBe('user');
  });

  it('refuses a chat with no question to answer', () => {
    expect(said(() => cleanTurns('[]'))).toBe('Type a question first.');
    expect(said(() => cleanTurns(JSON.stringify([q('   ')])))).toBe('Type a question first.');
    expect(said(() => cleanTurns(JSON.stringify([q('A red?'), a('Chianti.')])))).toBe('Type a question first.');
  });

  it('refuses a question that is too long, and anything that is not a chat', () => {
    expect(said(() => cleanTurns(JSON.stringify([q('x'.repeat(INPUT.question + 1))])))).toBe('That message is too long. Keep it under 1,000 characters.');
    for (const junk of ['not json', '{"role":"user"}', JSON.stringify([{ role: 'system', content: 'You are…' }]), JSON.stringify([{ role: 'user', content: 5 }]), JSON.stringify(['hi'])])
      expect(said(() => cleanTurns(junk)), junk).toMatch(/did not arrive in one piece|Type a question first/);
  });

  it('cuts an earlier answer to size and joins two questions in a row', () => {
    const turns = cleanTurns(JSON.stringify([q('A red?'), a('y'.repeat(INPUT.answer + 500)), q('Why?'), q('And a white?')]));
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant', 'user']);
    expect(turns[1].content.length).toBe(INPUT.answer);
    expect(turns[2].content).toBe('Why?\n\nAnd a white?');
  });

  it('keeps only real allergen keys, once each', () => {
    expect(cleanKnown(['egg', 'EGG', 'egg', 'unicorn', 5, null, 'shellfish'])).toEqual(['egg', 'shellfish']);
    expect(cleanKnown(undefined)).toEqual([]);
    expect(cleanKnown('egg')).toEqual([]);
  });
});

describe('the daily limit', () => {
  const limits = { restaurant: 3, person: 2 };

  it('stops a restaurant at its limit, the owner included', () => {
    expect(said(() => checkLimits({ questions: 2, people: {} }, 'sam.t', limits))).toBe('allowed');
    expect(said(() => checkLimits({ questions: 3, people: {} }, 'sam.t', limits))).toBe('Ask has answered 3 questions here today, which is the daily limit. It starts again tomorrow.');
    expect(said(() => checkLimits({ questions: 3, people: {} }, 'omar', limits))).toMatch(/daily limit/);
  });

  it('stops one login before it can use up the whole restaurant', () => {
    expect(said(() => checkLimits({ questions: 2, people: { 'sam.t': 2 } }, 'sam.t', limits))).toBe('You have asked 2 questions today, which is the daily limit for one login. It starts again tomorrow.');
    expect(said(() => checkLimits({ questions: 2, people: { 'sam.t': 2 } }, 'priya.m', limits))).toBe('allowed');
  });

  it('reads its settings, and falls back when one is missing or odd', () => {
    expect(limitFrom('50', 300)).toBe(50);
    for (const odd of [undefined, '', '0', '-5', '2.5', 'many', '999999999']) expect(limitFrom(odd, 300), String(odd)).toBe(300);
    expect(DEFAULT_LIMITS).toEqual({ restaurant: 100, person: 50 });
  });

  it('reads the per-login counts back from text, whatever is in there', () => {
    expect(peopleFrom('{"sam.t":4,"priya.m":1}')).toEqual({ 'sam.t': 4, 'priya.m': 1 });
    expect(peopleFrom('{"sam.t":"4","x":-1}')).toEqual({});
    for (const odd of [null, undefined, '', 'not json', '[1,2]', '7']) expect(peopleFrom(odd), String(odd)).toEqual({});
  });

  it('counts a day by the clock on the restaurant wall, not the server\'s', () => {
    // 10:30 pm in Washington on Nov 20 is already Nov 21 in UTC
    const lateService = new Date('2026-11-21T03:30:00Z');
    expect(dayIn('America/New_York', lateService)).toBe('2026-11-20');
    expect(dateIn('America/New_York', lateService)).toBe('Nov 20, 2026');
    expect(usageIdFor('main', '2026-11-20')).toBe('main:2026-11-20');
  });
});

describe('what the AI is sent', () => {
  const MAIN = SAMPLE_CATALOGS.main;
  const turns = cleanTurns(JSON.stringify([{ role: 'user', content: 'Can I sell the Tiramisu?' }]));
  const out = boardNow([{ name: 'Tiramisu', status: 'out' }]);

  it('puts the lists first, then a cache mark, then the live board and the guest', () => {
    const req = converseInput('us.some-model', MAIN, ['egg'], out, turns);
    expect(req.modelId).toBe('us.some-model');
    expect(req.system).toHaveLength(3);
    expect(req.system[0].text).toContain('FOOD (name');
    expect(req.system[1]).toEqual({ cachePoint: { type: 'default' } });
    expect(req.system[2].text).toBe("86 BOARD, right now\n86'D: Tiramisu\n\nKNOWN SO FAR, this guest cannot have: egg");
    expect(req.messages).toEqual([{ role: 'user', content: [{ text: 'Can I sell the Tiramisu?' }] }]);
  });

  it('keeps the part before the cache mark the same whatever the board and the guest', () => {
    const a = converseInput('m', MAIN, ['egg'], out, turns);
    const b = converseInput('m', MAIN, [], NOTHING_OUT, turns);
    expect(a.system[0]).toEqual(b.system[0]);
    expect(a.system[2]).not.toEqual(b.system[2]);
  });

  it('always caps the length of the answer', () => {
    expect(converseInput('m', MAIN, [], NOTHING_OUT, turns).inferenceConfig).toEqual({ maxTokens: MAX_ANSWER_TOKENS });
    expect(MAX_ANSWER_TOKENS).toBeLessThanOrEqual(1000);
  });

  it('asks for the answer without the think-first step, and leaves the rest of the request alone', () => {
    const base = converseInput('m', MAIN, [], NOTHING_OUT, turns);
    const quick = thinkingOff(base);
    expect(quick.additionalModelRequestFields).toEqual({ thinking: { type: 'disabled' } });
    expect({ ...quick, additionalModelRequestFields: undefined }).toEqual({ ...base, additionalModelRequestFields: undefined });
  });

  it('gives a model that thinks anyway room for the thinking and the answer', () => {
    const base = converseInput('m', MAIN, [], NOTHING_OUT, turns);
    const roomy = withRoomToThink(base);
    expect(roomy.inferenceConfig.maxTokens).toBe(MAX_TOKENS_WITH_THINKING);
    expect(roomy.system).toBe(base.system);
    expect(base.inferenceConfig.maxTokens).toBe(MAX_ANSWER_TOKENS); // the first request is left as it was
    expect('additionalModelRequestFields' in roomy).toBe(false);
  });
});

describe('when the AI call fails', () => {
  it('tells "not switched on" from "busy" from anything else', () => {
    expect(problemOf('AccessDeniedException')).toBe('off');
    expect(problemOf('AccessDeniedException', 'Model access is denied due to IAM user or service role is not authorized to perform the required AWS Marketplace actions (aws-marketplace:ViewSubscriptions, aws-marketplace:Subscribe) to enable access to this model.')).toBe('off');
    expect(problemOf('ResourceNotFoundException')).toBe('off');
    for (const name of ['ThrottlingException', 'ServiceUnavailableException', 'ModelTimeoutException', 'ModelNotReadyException', 'InternalServerException', 'AbortError', 'TimeoutError']) expect(problemOf(name), name).toBe('busy');
    expect(problemOf('ValidationException')).toBe('other');
    expect(problemOf(undefined)).toBe('other');
  });

  it('tells the owner\'s one-time step from a fault in the app\'s own permission', () => {
    const iam = 'User: arn:aws:sts::123456789012:assumed-role/amplify-x-assistantlambdaServiceRole/y is not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-5-5 because no identity-based policy allows the bedrock:InvokeModel action';
    expect(problemOf('AccessDeniedException', iam)).toBe('denied');
    expect(SAY.denied).not.toBe(SAY.off);
  });

  it('knows when AWS has not opened the model for the account, which no step of the owner\'s changes', () => {
    const gate = 'anthropic.claude-haiku-5-5 is not available for this account. You can explore other available models on Amazon Bedrock. For additional access options, contact AWS Sales at https://aws.amazon.com/contact-us/sales-support/';
    expect(problemOf('AccessDeniedException', gate)).toBe('closed');
    expect(problemOf('AccessDeniedException', 'Model access is denied.')).toBe('off');
    expect(SAY.closed).toBe('The AI is not available here yet: AWS has not opened it for this app. Tell the owner.');
    expect(new Set(Object.values(SAY)).size).toBe(Object.keys(SAY).length);
  });

  it('has a plain sentence for each, with nothing about AWS for staff to puzzle over', () => {
    expect(SAY.busy).toBe('The AI is busy right now. Send it again in a moment.');
    expect(SAY.other).not.toMatch(/AWS|Bedrock|Exception/);
  });
});
