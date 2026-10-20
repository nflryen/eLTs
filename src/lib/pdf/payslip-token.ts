import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Payslip signatures.
 *
 * TWO DIFFERENT SIGNATURES, ON PURPOSE
 * ------------------------------------
 * 1. `signSlipVerification(slipId, slipNumber, totalNet)` — a *document seal*
 *    bound to the content. It is what the QR encodes. If any figure on the slip
 *    changes, this signature stops matching, which is the whole point of a
 *    verification code. It has NO expiry: a 2026 payslip must still verify in
 *    2030.
 *
 * 2. `signPayslipDownloadToken(...)` — a *time-bound bearer token* for the PDF
 *    route, mirroring the invoice engine. Short-lived because the URL may travel
 *    through email or chat.
 *
 * Mixing them would be a design error: an expired download token must not make
 * the printed document look forged.
 */

const VERIFY_DOMAIN = "elts-payslip-verify-v1";
const DOWNLOAD_DOMAIN = "elts-payslip-pdf-v1";

/** Default download lifetime: 7 days, matching the invoice engine. */
export const PAYSLIP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hmac(domain: string, secret: string, body: string): string {
  return createHmac("sha256", secret).update(`${domain}.${body}`).digest("base64url");
}

/**
 * Canonical message for the document seal.
 *
 * `totalNet` is normalised to 2 decimals so `190000`, `190000.0` and
 * `"190000.00"` all produce the same signature — otherwise a formatting change
 * in the renderer would invalidate every printed slip.
 */
function verifyBody(slipId: string, slipNumber: string, totalNet: number | string): string {
  const amount = Number(totalNet).toFixed(2);
  return `${slipId}|${slipNumber}|${amount}`;
}

export function signSlipVerification(
  slipId: string,
  slipNumber: string,
  totalNet: number | string,
  secret: string,
): string {
  return hmac(VERIFY_DOMAIN, secret, verifyBody(slipId, slipNumber, totalNet));
}

export function verifySlipSignature(
  slipId: string,
  slipNumber: string,
  totalNet: number | string,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (typeof signature !== "string" || signature.length === 0 || signature.length > 512) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${VERIFY_DOMAIN}.${verifyBody(slipId, slipNumber, totalNet)}`)
    .digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

// ── Time-bound download token ───────────────────────────────────────────────

type DownloadClaim = { v: 1; slipId: string; exp: number };

export function signPayslipDownloadToken(
  slipId: string,
  secret: string,
  now = Date.now(),
  ttlMs = PAYSLIP_LINK_TTL_MS,
): string {
  const claim: DownloadClaim = { v: 1, slipId, exp: now + ttlMs };
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${hmac(DOWNLOAD_DOMAIN, secret, payload)}`;
}

export function verifyPayslipDownloadToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): DownloadClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  if (!payload || !supplied) return null;

  const expected = createHmac("sha256", secret)
    .update(`${DOWNLOAD_DOMAIN}.${payload}`)
    .digest();
  let signature: Buffer;
  try {
    signature = Buffer.from(supplied, "base64url");
  } catch {
    return null;
  }
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as DownloadClaim;
    if (parsed.v !== 1 || typeof parsed.slipId !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp < now) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Public verification URL encoded into the QR code. */
export function buildVerificationUrl(
  origin: string,
  slipId: string,
  signature: string,
): string {
  return `${origin.replace(/\/$/, "")}/verify/slip/${slipId}?sig=${signature}`;
}
