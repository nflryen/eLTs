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

/** Rupiah with thousands separators, no decimals: `Rp 15.000.000`. */
export function idr(amount: number): string {
  return `Rp ${amount.toLocaleString("id-ID")}`;
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
