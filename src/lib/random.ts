// A fresh shared key for the automations: 32 characters, letters and digits
// only, so it survives being pasted anywhere.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

// A whole number from 0 to n - 1, every one equally likely, from the
// browser's crypto. Feeds the password generator.
export function randomInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n; // drop the uneven tail
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % n;
}

export function newKey(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
