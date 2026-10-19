/**
 * Single source of truth for Indonesian phone normalisation.
 *
 * The studio receives numbers from four places that all disagree:
 *   - Clients type `0812-3456-7890` or `0812 3456 7890`
 *   - Crew records store `6281234567890`
 *   - Imported sheets carry `+62 812 3456 7890`
 *   - Some legacy rows hold `620812...` (country code applied twice)
 *
 * WhatsApp deep links require bare international digits: no `+`, no leading
 * zero, no separators. Anything else silently opens an empty chat, so this
 * module is deliberately strict and returns a result object rather than
 * guessing on ambiguous input.
 */

/** Canonical Indonesian country code. */
const ID_COUNTRY_CODE = "62";

/** Shortest plausible Indonesian mobile number after the country code. */
const MIN_NATIONAL_LENGTH = 8;

/** Longest plausible Indonesian number after the country code. */
const MAX_NATIONAL_LENGTH = 13;

export type NormalisedPhone = {
  /** Bare digits in international form, e.g. `6281234567890`. */
  e164: string;
  /** Whether the input looked like an Indonesian number. */
  isIndonesian: boolean;
};

export type PhoneParseResult =
  | { ok: true; phone: NormalisedPhone }
  | { ok: false; reason: "empty" | "too_short" | "too_long" | "not_digits" };

/**
 * Strip formatting and resolve to `62`-prefixed digits.
 *
 * Handles the `08`, `62`, and `+62` families, including the double-prefixed
 * `6208` case that arises when a stored `62` number is re-imported as local.
 */
export function normalisePhone(raw: string | null | undefined): PhoneParseResult {
  if (raw === null || raw === undefined) return { ok: false, reason: "empty" };

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };

  // Reject alphabetic input outright: `+62 (0) 812` style annotations are
  // common, but letters mean the field holds something that is not a number.
  if (/[a-z]/i.test(trimmed.replace(/^(tel|whatsapp|wa):/i, ""))) {
    return { ok: false, reason: "not_digits" };
  }

  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return { ok: false, reason: "not_digits" };

  // Collapse an accidental country code repeated by local-prefix logic.
  while (digits.startsWith(ID_COUNTRY_CODE + "0")) {
    digits = ID_COUNTRY_CODE + digits.slice(ID_COUNTRY_CODE.length + 1);
  }

  if (digits.startsWith("0")) {
    digits = ID_COUNTRY_CODE + digits.slice(1);
  } else if (digits.startsWith(ID_COUNTRY_CODE)) {
    // Already international.
  } else if (digits.startsWith("8")) {
    // Bare national mobile without the trunk zero, e.g. `81234567890`.
    digits = ID_COUNTRY_CODE + digits;
  } else {
    // A foreign number. Keep it as-is; the caller decides whether to send.
    const length = digits.length;
    if (length < MIN_NATIONAL_LENGTH) return { ok: false, reason: "too_short" };
    if (length > 15) return { ok: false, reason: "too_long" };
    return { ok: true, phone: { e164: digits, isIndonesian: false } };
  }

  const national = digits.slice(ID_COUNTRY_CODE.length);
  if (national.length < MIN_NATIONAL_LENGTH) return { ok: false, reason: "too_short" };
  if (national.length > MAX_NATIONAL_LENGTH) return { ok: false, reason: "too_long" };

  return { ok: true, phone: { e164: digits, isIndonesian: true } };
}

/**
 * Display form used on invoices and in the operator UI: `+62 812-3456-7890`.
 * Returns the original input untouched when it cannot be parsed, so a bad
 * record stays visible instead of turning into an empty cell.
 */
export function formatPhoneForDisplay(raw: string | null | undefined): string {
  const parsed = normalisePhone(raw);
  if (!parsed.ok) return (raw ?? "").trim();
  const d = parsed.phone.e164;
  if (!parsed.phone.isIndonesian) return `+${d}`;
  const national = d.slice(ID_COUNTRY_CODE.length);
  const groups = national.match(/.{1,4}/g) ?? [national];
  return `+${ID_COUNTRY_CODE} ${groups.join("-")}`;
}

/**
 * Build a `wa.me` deep link. Returns `null` rather than a broken URL when the
 * number cannot be normalised - the reminder engine surfaces that as a
 * missing field instead of sending the operator to an empty chat.
 */
export function buildWhatsAppLink(
  raw: string | null | undefined,
  message?: string
): string | null {
  const parsed = normalisePhone(raw);
  if (!parsed.ok) return null;
  const query = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${parsed.phone.e164}${query}`;
}
