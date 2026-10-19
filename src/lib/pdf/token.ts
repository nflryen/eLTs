import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Signed, time-limited tokens for invoice PDF downloads.
 *
 * Invoices are financial records held behind rank >= 100 RLS. Email and
 * WhatsApp are the delivery channels, and neither can present a session
 * cookie, so the link itself must carry proof of authorisation. The token is
 * an HMAC over the invoice id plus an absolute expiry: it cannot be edited to
 * point at another invoice, and it stops working on its own.
 */

const claimSchema = z.object({
  v: z.literal(1),
  invoiceId: z.uuid(),
  /** Absolute expiry, epoch milliseconds. */
  exp: z.number().int().positive(),
});
export type PdfClaim = z.infer<typeof claimSchema>;

/** Default lifetime: long enough for a client to open an email, short enough to expire. */
export const PDF_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DOMAIN = "elts-invoice-pdf-v1";

export function signInvoicePdfToken(
  invoiceId: string,
  secret: string,
  now = Date.now(),
  ttlMs = PDF_LINK_TTL_MS
): string {
  const claim: PdfClaim = { v: 1, invoiceId, exp: now + ttlMs };
  const payload = Buffer.from(JSON.stringify(claimSchema.parse(claim))).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${DOMAIN}.${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Verify a token. Returns the claim only when the signature is valid, the
 * claim parses, and the link has not expired.
 */
export function verifyInvoicePdfToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now()
): PdfClaim | null {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  if (!payload || !supplied) return null;

  const expected = createHmac("sha256", secret).update(`${DOMAIN}.${payload}`).digest();
  const signature = Buffer.from(supplied, "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return null;

  try {
    const parsed = claimSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!parsed.success) return null;
    if (parsed.data.exp <= now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
