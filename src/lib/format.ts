/**
 * Shared formatting helpers for printable and plain-text output.
 *
 * WHY SHARED
 * ----------
 * The packing slip, the vendor PO, and the WhatsApp generators all render the
 * same numbers and the same user-supplied strings. Duplicating these locally in
 * each route is how a currency format drifts between the PDF a vendor receives
 * and the WhatsApp message they receive — and then the vendor queries the total.
 */

/**
 * Rupiah with thousands separators, no decimals: `Rp 15.000.000`.
 *
 * ACCEPTS `number | null | undefined` ON PURPOSE.
 *
 * A monetary value that is absent is a real state — a line item persisted
 * before `subtotal` existed, a receipt with no recorded amount, a view column
 * that came back null. Calling `.toLocaleString()` on it threw
 * "Cannot read properties of undefined (reading 'toLocaleString')" and took the
 * entire invoice page down with an error boundary, because this function is
 * called directly from render.
 *
 * A formatter must never be able to crash a page. Absent money renders as
 * "Rp 0" rather than "Rp NaN" or a stack trace: the page stays usable and the
 * zero is visibly a zero, not a silently wrong number.
 */
export function idr(amount: number | null | undefined): string {
  const value = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return `Rp ${value.toLocaleString("id-ID")}`;
}

/**
 * Escapes text for HTML interpolation.
 *
 * Every printable route builds HTML by string concatenation, so any user-supplied
 * value (project name, vendor name, asset name) must pass through here or it can
 * inject markup into a document that gets printed and filed.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
