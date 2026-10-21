/**
 * Pure helpers shared by the pricelist CMS forms.
 *
 * WHY NOT IN src/lib/pricelist.ts
 * -------------------------------
 * That module is `server-only`: it holds the public read model and imports the
 * server Supabase client. A Client Component importing it would fail the build.
 * These helpers are the inverse — they run in the browser while the operator
 * types — so they live in their own dependency-free module.
 *
 * WHY ARRAYS ARE EDITED AS TEXT
 * -----------------------------
 * `pricelist_packages.crew` / `includes` are `text[]` because the comparison
 * view counts entries. The operator, however, thinks in lines: pasting a quote's
 * deliverables into one textarea is the fastest way to enter twelve of them.
 * Splitting on newlines AND commas here means both habits work, and the
 * normalisation (trim, drop blanks) happens once rather than in each form.
 */

/**
 * Splits a textarea value into list entries.
 *
 * Accepts newline- and/or comma-separated input, trims each entry, and drops
 * empty ones — an empty textarea must produce `[]`, never `[""]`, or the
 * comparison view counts a phantom deliverable.
 */
export function parseTextList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Derives a valid slug from a display name, matching the CHECK constraint
 * `/^[a-z0-9]+(-[a-z0-9]+)*$/` on all three slug columns.
 *
 * Returns an empty string when nothing usable remains (e.g. a name written
 * entirely in characters outside the allowed set), so the field stays empty and
 * the operator is forced to type one instead of silently submitting "".
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `350000` → `350.000`, so the price field stays readable while the operator
 * edits it and the raw string round-trips back through the action's schema.
 *
 * There is deliberately NO inverse parser here: `priceSchema` in
 * `admin-pricelist.ts` already strips separators and validates the integer, and
 * a second implementation would let the two disagree about what "empty" means.
 */

export function formatRupiahInput(amount: number | null | undefined): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "";
  return amount.toLocaleString("id-ID");
}
