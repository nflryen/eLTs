import "server-only";
import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";

const KEY_LENGTH = 32;
// OWASP scrypt profile: N=2^15, r=8, p=3; limit concurrency at the access handler.
const OPTIONS = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

function derive(pin: string, salt: string, pepper: string): Promise<Buffer> {
  const input = createHmac("sha256", pepper).update(pin).digest();
  return new Promise((resolve, reject) =>
    scrypt(input, salt, KEY_LENGTH, OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashGalleryPin(
  pin: string,
  pepper: string,
): Promise<string> {
  if (!/^\d{4,12}$/.test(pin))
    throw new Error("PIN must contain 4 to 12 digits.");
  if (pepper.length < 43)
    throw new Error("A strong server-side PIN pepper is required.");
  const salt = randomBytes(16).toString("base64url");
  const hash = await derive(pin, salt, pepper);
  return `scrypt-v2$${salt}$${hash.toString("base64url")}`;
}

export async function verifyGalleryPin(
  pin: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  if (pin.length < 4 || pin.length > 12 || pepper.length < 43) return false;
  const match = /^scrypt-v[12]\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(
    stored,
  );
  if (!match) return false;
  const actual = await derive(pin, match[1], pepper);
  const expected = Buffer.from(match[2], "base64url");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function generateGalleryCredentials() {
  return {
    galleryCode: `ELTS-${randomBytes(5).toString("hex").slice(0, 8).toUpperCase()}`,
    pin: randomInt(0, 1_000_000).toString().padStart(6, "0"),
    accessToken: randomBytes(32).toString("base64url"),
  };
}

/** Only for verification/migration of the old mislabelled SHA-256 envelopes.
 * New credentials always use real scrypt. Persist upgradedHash atomically before login.
 */
export async function verifyAndUpgradeGalleryPin(pin: string, stored: string, pepper: string): Promise<{ valid: boolean; upgradedHash?: string }> {
  if (pin.length < 4 || pin.length > 12 || pepper.length < 43) return { valid: false };
  const match = /^scrypt-v([12])\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/.exec(stored);
  if (!match) return { valid: false };
  const validScrypt = await verifyGalleryPin(pin, stored, pepper);
  const legacy = createHash('sha256').update(pepper + match[2] + pin).digest();
  const expected = Buffer.from(match[3], 'base64url');
  const validLegacy = match[1] === '1' && expected.length === legacy.length && timingSafeEqual(legacy, expected);
  if (!validScrypt && !validLegacy) return { valid: false };
  if (match[1] === '2') return { valid: true };
  const salt = randomBytes(16).toString('base64url');
  const key = await derive(pin, salt, pepper);
  return { valid: true, upgradedHash: `scrypt-v2$${salt}$${key.toString('base64url')}` };
}

export async function performDummyPinVerification(pepper: string) {
  await derive('000000', 'elts-missing-code-salt', pepper);
}

export function createOpaqueSession() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
