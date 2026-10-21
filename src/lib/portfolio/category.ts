/**
 * Portfolio category vocabulary — ONE source of truth.
 *
 * WHY THIS FILE AND NOT THE ACTION MODULE
 * ---------------------------------------
 * `src/app/actions/portfolio.ts` carries `"use server"`, so it may export only
 * async functions: a `PORTFOLIO_CATEGORIES` array exported from there fails the
 * build. The admin selectors, the public filter chips and the zod enum all need
 * the same five values, and migration 0028's CHECK constraint is the fourth
 * copy. The migration's comment promises the CMS selector is generated from one
 * list — this is that list.
 *
 * The values match `portfolio_pages_category_check`. Adding one here without
 * adding it there produces a constraint violation at save time, which is the
 * correct direction for that failure to point.
 */

export const PORTFOLIO_CATEGORIES = [
  "wedding",
  "prewedding",
  "graduation",
  "couple",
  "event",
] as const;

export type PortfolioCategory = (typeof PORTFOLIO_CATEGORIES)[number];

/** Display labels. The stored value stays lowercase and machine-readable. */
export const PORTFOLIO_CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  wedding: "Wedding",
  prewedding: "Prewedding",
  graduation: "Graduation",
  couple: "Couple",
  event: "Event",
};

/** Type guard, so a `text` column narrows to the vocabulary after the check. */
export function isPortfolioCategory(value: unknown): value is PortfolioCategory {
  return (
    typeof value === "string" &&
    (PORTFOLIO_CATEGORIES as readonly string[]).includes(value)
  );
}

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 32;

/**
 * Tags are free-form browsing labels, so they are normalised rather than
 * validated: trimmed, de-duplicated case-insensitively (so "Outdoor" and
 * "outdoor" cannot both exist), and capped so a pasted paragraph cannot become
 * hundreds of chips. The operator's own casing is KEPT — they typed "Golden
 * Hour" and that is what the chip should read.
 */
export function normalisePortfolioTags(input: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const raw of input) {
    const tag = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === MAX_TAGS) break;
  }

  return tags;
}
