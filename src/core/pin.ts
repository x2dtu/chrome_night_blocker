// Salted PBKDF2 hashing for block set PINs (WebCrypto), so the PIN isn't readable from storage.
// Stored format: `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>` — same as the Android app.
// There is no recovery: a forgotten PIN means removing and reinstalling the extension.

const PREFIX = "pbkdf2-sha256";
const ITERATIONS = 120_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 12;

export function isValidPin(pin: string): boolean {
  return pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH && /^[0-9]+$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new RangeError(`PIN must be ${PIN_MIN_LENGTH}-${PIN_MAX_LENGTH} digits`);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(pin, salt, ITERATIONS);
  return [PREFIX, String(ITERATIONS), toBase64(salt), toBase64(hash)].join("$");
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== PREFIX) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array<ArrayBuffer>, expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return false;
  }
  return constantTimeEqual(await derive(pin, salt, iterations), expected);
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS);
  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
