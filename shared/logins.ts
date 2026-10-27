// Usernames and passwords as plain functions, shared by the app, the sample
// mode and the staff-admin function. No AWS and no browser in here, so the
// tests can check every rule.

// ---------- usernames ----------

// Letters with accents become plain letters: "josé peña" -> "jose pena".
// Without this the app showed josé.peña but saved jos.pea.
const SPECIAL: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ł: 'l', ı: 'i' };

export const plainLetters = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ßæœøđłı]/g, (c) => SPECIAL[c] ?? c);

// What a manager types, as it will be saved: lowercase plain letters,
// digits, dot, dash and underscore. Nothing else.
export const cleanUsername = (raw: string): string =>
  plainLetters(raw.trim().toLowerCase()).replace(/[^a-z0-9._-]/g, '');

// The suggestion from a name: "Marco R." -> "marco.r", "José Peña" -> "jose.pena".
export const usernameFor = (displayName: string): string =>
  cleanUsername(
    plainLetters(displayName.toLowerCase())
      .replace(/\./g, '')
      .trim()
      .split(/\s+/)
      .join('.'),
  );

// The usernames to try, in order: marco.r, marco.r2, marco.r3 ... The first
// one nobody has is the one the new person gets.
export function usernameCandidates(base: string, max = 99): string[] {
  if (!base) return [];
  const out = [base];
  for (let n = 2; n <= max; n++) out.push(`${base}${n}`);
  return out;
}

export function nextFreeUsername(base: string, isTaken: (username: string) => boolean): string | null {
  return usernameCandidates(base).find((u) => !isTaken(u)) ?? null;
}

// ---------- passwords ----------

// Kitchen words: short, easy to spell, easy to read out over the pass.
export const WORDS: readonly string[] = `
basil tray fennel pass ladle whisk sage thyme mint dill chive cumin clove anise caper olive
lemon lime orange melon mango peach plum pear apple grape fig date cherry berry kiwi guava
papaya quince apricot almond pecan walnut cashew hazel honey sugar salt pepper chili paprika
saffron vanilla cocoa coffee latte mocha cream butter cheese brie feta gouda ricotta burrata
pasta penne ravioli risotto polenta orzo farro barley rice bread toast bagel brioche crust
dough flour yeast crumb waffle pancake crepe tart pie cake cookie muffin scone fudge toffee
caramel praline sorbet gelato custard pudding mousse jam jelly syrup broth stock soup stew
chowder gravy sauce salsa pesto aioli mustard relish pickle onion garlic shallot leek carrot
celery radish turnip beet potato yam squash pumpkin eggplant tomato corn pea bean lentil kale
chard spinach lettuce arugula endive cabbage sprout okra mushroom truffle salmon tuna trout
cod halibut oyster clam mussel shrimp crab lobster squid scallop anchovy sardine steak
brisket bacon ham salami sausage chicken duck quail turkey lamb veal pork egg omelet skillet
wok pot pan grill oven broiler fryer plate bowl cup mug glass fork spoon knife tongs spatula
apron napkin menu table booth bar counter ticket order chef cook runner expo line prep
station pantry cellar cork wine cider soda tonic ice spritz bitters ginger nutmeg sesame
poppy oregano parsley rosemary tarragon cilantro marjoram sorrel nori miso tofu tahini hummus
falafel pita naan tortilla taco nacho burrito ramen udon soba sushi tempura curry masala
dumpling bao kimchi paella tapas crudo confit sear braise roast poach glaze zest sieve mortar
pestle grater peeler colander kettle teapot carafe decanter pitcher saucer platter tureen
ramekin
`
  .trim()
  .split(/\s+/);

export const SYMBOLS: readonly string[] = ['!', '?'];

// 0 <= result < n. The app passes the browser's crypto, the server passes
// Node's, the tests pass a fixed sequence.
export type RandomInt = (n: number) => number;

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

// Basil-Tray-4821! : two different kitchen words, four digits, a symbol.
// Always has a capital, a lowercase letter, a number and a symbol, and is
// longer than 8 characters, so it passes the login rules.
export function passwordFrom(randomInt: RandomInt): string {
  const a = randomInt(WORDS.length);
  let b = randomInt(WORDS.length - 1);
  if (b >= a) b += 1; // never the same word twice
  const digits = 1000 + randomInt(9000);
  const symbol = SYMBOLS[randomInt(SYMBOLS.length)];
  return `${cap(WORDS[a])}-${cap(WORDS[b])}-${digits}${symbol}`;
}

// How many different passwords passwordFrom can make.
export const PASSWORD_COMBINATIONS = WORDS.length * (WORDS.length - 1) * 9000 * SYMBOLS.length;

// The same rules the login system enforces.
export const passesPolicy = (p: string): boolean =>
  p.length >= 8 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);

// ---------- the note to send a new person ----------

export interface LoginMessageInput {
  name: string;
  link: string;
  username: string;
  password: string;
  temporary: boolean;
}

export function loginMessage({ name, link, username, password, temporary }: LoginMessageInput): string {
  const first = name.trim().split(/\s+/)[0] || 'there';
  return [
    `Hi ${first}, here is your 86 Board login.`,
    `Open: ${link}`,
    `Username: ${username}`,
    `${temporary ? 'Temporary password' : 'Password'}: ${password}`,
    ...(temporary ? ['You pick your own password the first time you sign in.'] : []),
  ].join('\n');
}
