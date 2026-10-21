import "server-only";

import type { ServiceSupabaseClient } from "@/lib/supabase/service";
import type { InquiryAddon } from "@/types/database";

/*
 * Authoritative price resolution for consultation leads.
 *
 * THE RULE
 * --------
 * A client-supplied price is never trusted. The public configurator shows a
 * live total so the visitor knows roughly what they are choosing, but the
 * numbers that reach the database — and later the invoice — are re-read from
 * `pricelist_packages` / `pricelist_addons` at submission time.
 *
 * Why this matters beyond tidiness: the add-on selection travels through the
 * URL (`?addons=content-creator-only`) and is therefore trivially editable. If
 * we persisted whatever the browser sent, a lead could arrive claiming a
 * Rp 2.250.000 live-streaming add-on costs Rp 0, and the operator converting
 * that lead into an invoice would inherit the fabricated figure.
 *
 * SLUGS, NOT UUIDs
 * ----------------
 * The configurator keys add-ons by slug because the slug is what the public URL
 * carries and what a human can read. `pricelist_addons.id` is a UUID. Resolution
 * therefore queries by slug and returns the canonical `{ id, name, price_idr }`
 * where `id` is the UUID — so `inquiries.selected_addons[].id` is joinable
 * against `pricelist_addons` later without a fuzzy name match.
 *
 * UNKNOWN SELECTIONS
 * ------------------
 * An add-on slug that no longer exists (retired, renamed, or forged) is DROPPED
 * rather than persisted at price 0. Persisting a zero-price row would put a
 * phantom line item on the eventual invoice; dropping it means the lead simply
 * does not mention that add-on. The dropped slugs are returned to the caller so
 * the submission can be logged rather than silently altered.
 */

export type ResolvedPricing = {
  /** Canonical add-ons, priced from the database. Never client-supplied. */
  addons: InquiryAddon[];
  /** Package price from the database, or null when no package was chosen. */
  packagePriceIdr: number | null;
  packageName: string | null;
  /** packagePrice + Σ(addon price × qty). Null when no package resolved. */
  totalEstimateIdr: number | null;
  /** Slugs the client asked for that no longer exist. */
  unknownAddonSlugs: string[];
  /** True when the requested package id did not resolve to a live row. */
  unknownPackage: boolean;
};

/** A raw selection as it arrives from the public form. */
export type RawAddonSelection = {
  /** Slug from the configurator URL. */
  id: string;
  /** Quantity; 1 when the add-on is not unit-priced. */
  qty?: number;
};

const MAX_ADDONS = 20;
const MAX_QTY = 99;

/**
 * Resolve add-on slugs and an optional package id against the live pricelist.
 *
 * Runs at most two queries regardless of how many add-ons were selected.
 */
export async function resolveLeadPricing(
  supabase: ServiceSupabaseClient,
  input: {
    addons?: RawAddonSelection[];
    packageId?: string | null;
  },
): Promise<ResolvedPricing> {
  /*
   * Collapse duplicates and clamp quantity BEFORE querying. The configurator
   * cannot emit duplicates today, but the value arrives over the wire and this
   * is the trust boundary.
   */
  const wanted = new Map<string, number>();
  for (const item of input.addons ?? []) {
    const slug = item.id?.trim();
    if (!slug) continue;
    const qty = Math.min(Math.max(Math.trunc(item.qty ?? 1) || 1, 1), MAX_QTY);
    wanted.set(slug, Math.min((wanted.get(slug) ?? 0) + qty, MAX_QTY));
  }
  const slugs = Array.from(wanted.keys()).slice(0, MAX_ADDONS);

  const addonQuery =
    slugs.length > 0
      ? supabase
          .from("pricelist_addons")
          .select("id, slug, name, price_idr")
          .in("slug", slugs)
          .eq("is_active", true)
      : null;

  const packageQuery = input.packageId
    ? supabase
        .from("pricelist_packages")
        .select("id, name, price_idr")
        .eq("id", input.packageId)
        .eq("is_active", true)
        .maybeSingle()
    : null;

  const [addonResult, packageResult] = await Promise.all([
    addonQuery ?? Promise.resolve({ data: [], error: null }),
    packageQuery ?? Promise.resolve({ data: null, error: null }),
  ]);

  if (addonResult.error) {
    /*
     * Fail the submission rather than persisting an unpriced selection. A lead
     * with add-ons but no prices is worse than a failed submit: the operator
     * would quote from memory.
     */
    throw new Error(`Gagal memuat harga add-on: ${addonResult.error.message}`);
  }

  const addons: InquiryAddon[] = [];
  let addonsTotal = 0;
  const seen = new Set<string>();

  for (const row of (addonResult.data ?? []) as {
    id: string;
    slug: string;
    name: string;
    price_idr: number;
  }[]) {
    const qty = wanted.get(row.slug) ?? 1;
    const unit = Number(row.price_idr) || 0;
    seen.add(row.slug);
    /*
     * One entry per add-on, with the price multiplied by quantity.
     *
     * The persisted shape is fixed at { id, name, price_idr } — there is no
     * qty field in the contract — so a qty>1 add-on is stored at its line total
     * and the name records the multiplier. Storing the unit price instead would
     * silently under-quote every unit-priced add-on (overtime crew, extra
     * videographer), which is precisely the class of error this module exists
     * to prevent.
     */
    addons.push({
      id: row.id,
      name: qty > 1 ? `${row.name} × ${qty}` : row.name,
      price_idr: unit * qty,
    });
    addonsTotal += unit * qty;
  }

  const unknownAddonSlugs = slugs.filter((s) => !seen.has(s));

  const pkg = packageResult.data as { id: string; name: string; price_idr: number } | null;
  const packagePriceIdr = pkg ? Number(pkg.price_idr) || 0 : null;

  return {
    addons,
    packagePriceIdr,
    packageName: pkg?.name ?? null,
    totalEstimateIdr: packagePriceIdr === null ? null : packagePriceIdr + addonsTotal,
    unknownAddonSlugs,
    unknownPackage: Boolean(input.packageId) && !pkg,
  };
}

/**
 * Parse the configurator's `addons` URL param.
 *
 * Format is `slug` or `slug:qty`, comma-separated. Kept here so the client
 * component, the server action, and any future importer share one parser —
 * a second implementation would eventually disagree about `:qty`.
 */
export function parseAddonParam(raw: string | undefined | null): RawAddonSelection[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const [slug, qtyText] = token.split(":");
      const qty = Number.parseInt(qtyText ?? "", 10);
      return {
        id: (slug ?? "").trim(),
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      };
    })
    .filter((item) => item.id.length > 0);
}

/** Total of already-resolved add-ons, for display in the admin pipeline. */
export function sumAddons(addons: InquiryAddon[] | null | undefined): number {
  return (addons ?? []).reduce((acc, a) => acc + (Number(a.price_idr) || 0), 0);
}
