// The rules for Ask, as plain functions with no AWS in them: who may use it,
// what a phone may send, how many questions a day, and what the AI is sent.
// The handler asks these; the tests do too.
import { readerGroupsFor } from '../../../shared/sample-data';
import type { AllergenKey, AssistantCatalog, BoardNow } from '../../../shared/assistant/catalog';
import { isAllergenKey } from '../../../shared/assistant/catalog';
import { leadFixed, leadLive, recentTurns, type Turn } from '../../../shared/assistant/prompt';

export class Refused extends Error {}

export interface Actor {
  username: string;
  groups: string[];
  isOwner: boolean;
}

export function actorFromIdentity(identity: { username?: string; groups?: string[] | null } | null | undefined): Actor {
  if (!identity || !identity.username) throw new Refused('Sign in first.');
  const groups = identity.groups ?? [];
  return { username: identity.username, groups, isOwner: groups.includes('owner') };
}

// The owner always. Staff only at their own restaurant, and only once the
// owner has opened Ask to them there.
export function mayUse(actor: Actor, restaurantId: string, staffCanUse: boolean): boolean {
  if (actor.isOwner) return true;
  return staffCanUse && readerGroupsFor(restaurantId).some((g) => actor.groups.includes(g));
}

// ---------- what a phone may send ----------

export const INPUT = {
  turns: 40, // messages accepted; only the last ten are sent on
  question: 1_000, // characters in one question
  answer: 4_000, // characters kept of an earlier answer
} as const;

export const NOT_SET_UP = 'Ask is not set up for this restaurant.';

// The chat as the phone sent it (JSON text) -> clean turns, or Refused.
export function cleanTurns(raw: unknown): Turn[] {
  let list: unknown = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      throw new Refused('That question did not arrive in one piece. Send it again.');
    }
  }
  if (!Array.isArray(list) || list.length === 0) throw new Refused('Type a question first.');
  if (list.length > INPUT.turns) list = list.slice(-INPUT.turns);
  const turns: Turn[] = [];
  for (const t of list as unknown[]) {
    const role = (t as { role?: unknown } | null)?.role;
    const content = (t as { content?: unknown } | null)?.content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') throw new Refused('That question did not arrive in one piece. Send it again.');
    const text = content.trim();
    if (!text) continue;
    if (role === 'user' && text.length > INPUT.question) throw new Refused(`That message is too long. Keep it under ${INPUT.question.toLocaleString('en-US')} characters.`);
    turns.push({ role, content: role === 'assistant' ? text.slice(0, INPUT.answer) : text });
  }
  const recent = recentTurns(turns);
  if (recent.length === 0 || recent[recent.length - 1].role !== 'user') throw new Refused('Type a question first.');
  return recent;
}

// Allergen keys only; anything else the phone sent is dropped.
export const cleanKnown = (raw: unknown): AllergenKey[] => (Array.isArray(raw) ? [...new Set(raw.filter((k): k is AllergenKey => typeof k === 'string' && isAllergenKey(k)))] : []);

// ---------- the daily limit ----------

export interface Limits {
  restaurant: number; // questions a day at one restaurant
  person: number; // questions a day from one login
}

export const DEFAULT_LIMITS: Limits = { restaurant: 100, person: 50 };

// A limit from a setting, or the default when the setting is missing or odd.
export function limitFrom(setting: string | undefined, fallback: number): number {
  const n = Number(setting);
  return Number.isInteger(n) && n > 0 && n <= 100_000 ? n : fallback;
}

export interface UsageSoFar {
  questions: number;
  people: Record<string, number>;
}

// people is kept as JSON text in the usage row.
export function peopleFrom(text: string | null | undefined): Record<string, number> {
  if (!text) return {};
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = n;
    return out;
  } catch {
    return {};
  }
}

// Refused once today's questions are used up. The owner is held to the
// restaurant's limit too: it is there to cap the bill, whoever is asking.
export function checkLimits(usage: UsageSoFar, username: string, limits: Limits): void {
  if (usage.questions >= limits.restaurant) {
    throw new Refused(`Ask has answered ${limits.restaurant} questions here today, which is the daily limit. It starts again tomorrow.`);
  }
  if ((usage.people[username] ?? 0) >= limits.person) {
    throw new Refused(`You have asked ${limits.person} questions today, which is the daily limit for one login. It starts again tomorrow.`);
  }
}

// The calendar day in the restaurant's time zone, as YYYY-MM-DD.
export const dayIn = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// "Nov 20, 2026"
export const dateIn = (timeZone: string, now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }).format(now);

export const usageIdFor = (restaurantId: string, day: string): string => `${restaurantId}:${day}`;

// ---------- what the AI is sent ----------

export const MAX_ANSWER_TOKENS = 700;
// When the model does its thinking anyway, the thinking counts toward the
// same limit, so it needs room on top of the answer.
export const MAX_TOKENS_WITH_THINKING = 2_500;

// The request for Amazon Bedrock's Converse call. The fixed part of what the
// AI reads comes first with a cache mark after it, so Bedrock can keep it
// ready for the next question (five minutes) and bill a tenth for reading it
// again. The live part (the 86 board, the guest) follows the mark.
export function converseInput(modelId: string, catalog: AssistantCatalog, known: AllergenKey[], now: BoardNow, turns: Turn[]) {
  return {
    modelId,
    system: [{ text: leadFixed(catalog) }, { cachePoint: { type: 'default' as const } }, { text: leadLive(catalog, known, now) }],
    messages: turns.map((t) => ({ role: t.role, content: [{ text: t.content }] })),
    inferenceConfig: { maxTokens: MAX_ANSWER_TOKENS },
  };
}

// Ask's answers are look-ups in the lists, on a phone, mid-service: quick
// beats deep. A Claude 5 model thinks before it answers unless told not to
// (AWS: thinking.type "disabled", passed through additionalModelRequestFields).
// Earlier models answer the quick way as they are; shared/assistant/model.ts
// knows which is which.
export const thinkingOff = <T extends object>(input: T) => ({ ...input, additionalModelRequestFields: { thinking: { type: 'disabled' } } });

// For a model that refuses that setting: ask without it, with room to think.
export const withRoomToThink = <T extends { inferenceConfig: { maxTokens: number } }>(input: T): T => ({ ...input, inferenceConfig: { ...input.inferenceConfig, maxTokens: MAX_TOKENS_WITH_THINKING } });

// ---------- when the AI call fails ----------

export type ModelProblem = 'off' | 'closed' | 'denied' | 'busy' | 'other';

// AWS answers "access denied" for three different things. The model is not
// switched on for this AWS account yet (a one-time step for the owner). Or
// AWS has not opened the model for this account at all, which AWS words as
// "is not available for this account": no step of the owner's changes that,
// only AWS does, or another model. Or this app's own permission does not
// cover the model (a fault in the app's setup, which AWS words as "not
// authorized to perform: bedrock:..."). The rest are passing trouble.
export function problemOf(errorName: string | undefined, message = ''): ModelProblem {
  if (errorName === 'AccessDeniedException' && /not authorized to perform: bedrock:/i.test(message)) return 'denied';
  if (errorName === 'AccessDeniedException' && /is not available for this account/i.test(message)) return 'closed';
  if (errorName === 'AccessDeniedException' || errorName === 'ResourceNotFoundException') return 'off';
  if (
    errorName === 'ThrottlingException' ||
    errorName === 'ServiceUnavailableException' ||
    errorName === 'ModelTimeoutException' ||
    errorName === 'ModelNotReadyException' ||
    errorName === 'InternalServerException' ||
    errorName === 'AbortError' ||
    errorName === 'TimeoutError'
  ) {
    return 'busy';
  }
  return 'other';
}

export const SAY: Record<ModelProblem, string> = {
  off: 'The AI is not switched on for this app yet. The owner turns it on once, in AWS.',
  closed: 'The AI is not available here yet: AWS has not opened it for this app. Tell the owner.',
  denied: 'The AI is not available: this app is not allowed to call it. Tell the owner.',
  busy: 'The AI is busy right now. Send it again in a moment.',
  other: 'The AI could not answer that. Send it again.',
};
