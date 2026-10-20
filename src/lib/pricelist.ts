import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

/**
 * Public pricelist read model (migration 0025).
 *
 * WHY THE USER-SCOPED CLIENT AND NOT THE SERVICE ROLE
 * ---------------------------------------------------
 * `pricelist_*` is readable by `anon` through RLS — that policy exists for
 * exactly this page. Reading it through the service-role client would mask a
 * broken policy: the public page would keep rendering prices while every
 * anonymous API consumer silently received an empty list. Going through
 * `createServerSupabase()` makes a policy regression fail here, in the same
 * request a visitor makes, instead of only in production logs.
 *
 * WHY THIS NEVER THROWS
 * ---------------------
 * A price list that 500s is worse than a price list that is briefly empty. The
 * visitor came for prices and an error page gives them nothing; an empty
 * structure at least lets the page render its own honest "hubungi kami" state.
 * Every failure is logged with a stable key so it is greppable in production.
 *
 * WHY PRICES ARE NOT HARDCODED HERE
 * ---------------------------------
 * The same rows feed the invoice builder. If the public page carried its own
 * copy of the numbers, a price change would have to be made twice and the two
 * would drift — the client would be quoted one number and invoiced another.
 */

type PricelistTables = Database["public"]["Tables"];

/** Only the columns the public surface renders — `created_at` etc. are noise. */
type CategoryRow = Pick<
  PricelistTables["pricelist_categories"]["Row"],
  "id" | "slug" | "name" | "description"
>;

type PackageRow = Pick<
  PricelistTables["pricelist_packages"]["Row"],
  | "id"
  | "category_id"
  | "slug"
  | "name"
  | "price_idr"
  | "duration"
  | "max_persons"
  | "crew"
  | "includes"
  | "badge"
  | "notes"
>;

type AddonRow = Pick<
  PricelistTables["pricelist_addons"]["Row"],
  "id" | "slug" | "name" | "price_idr" | "unit" | "description"
>;

export type PricelistPackage = {
  id: string;
  slug: string;
  name: string;
  priceIdr: number;
  duration: string | null;
  maxPersons: number | null;
  /**
   * `crew` and `includes` stay arrays rather than a paragraph: the comparison
   * view diffs packages on crew count and edited-photo count without parsing
   * prose, which is the reason 0025 stores them as text[] in the first place.
   */
  crew: string[];
  includes: string[];
  badge: string | null;
  notes: string | null;
};

export type PricelistCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  packages: PricelistPackage[];
};

export type PricelistAddon = {
  id: string;
  slug: string;
  name: string;
  priceIdr: number;
  /** Non-null means the price is per unit — the configurator then multiplies. */
  unit: string | null;
  description: string | null;
};

export type Pricelist = {
  categories: PricelistCategory[];
  addons: PricelistAddon[];
};

function emptyPricelist(): Pricelist {
  /* A fresh object every call: callers must not share mutable state. */
  return { categories: [], addons: [] };
}

export async function getPricelist(): Promise<Pricelist> {
  try {
    const supabase = await createServerSupabase();

    /*
     * One query per table, run concurrently, then nested in memory. The
     * alternative — PostgREST embedded selects — would depend on the FK being
     * exposed as a relationship, and three flat reads are cheaper to reason
     * about than a join whose shape changes with the generated types.
     */
    const [categoryResult, packageResult, addonResult] = await Promise.all([
      supabase
        .from("pricelist_categories")
        .select("id, slug, name, description")
        /*
         * `.eq("is_active", true)` repeats the RLS predicate on purpose: the
         * read policy is written for anon, but an authenticated admin can see
         * inactive rows through this same client. The public surface must not
         * start listing retired packages the moment an operator logs in.
         */
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("pricelist_packages")
        .select(
          "id, category_id, slug, name, price_idr, duration, max_persons, crew, includes, badge, notes",
        )
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("pricelist_addons")
        .select("id, slug, name, price_idr, unit, description")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    if (categoryResult.error) {
      console.error("pricelist_categories_failed", {
        code: categoryResult.error.code,
      });
      return emptyPricelist();
    }

    /*
     * A package failure needs no early return: every category below loses its
     * packages and is filtered out, so the caller renders the same empty state
     * whether the read failed or the table is genuinely empty.
     */
    if (packageResult.error) {
      console.error("pricelist_packages_failed", {
        code: packageResult.error.code,
      });
    }

    if (addonResult.error) {
      console.error("pricelist_addons_failed", {
        code: addonResult.error.code,
      });
    }

    const packagesByCategory = new Map<string, PricelistPackage[]>();
    for (const row of (packageResult.data ?? []) as PackageRow[]) {
      const pkg: PricelistPackage = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        priceIdr: row.price_idr,
        duration: row.duration,
        maxPersons: row.max_persons,
        crew: row.crew ?? [],
        includes: row.includes ?? [],
        badge: row.badge,
        notes: row.notes,
      };
      const bucket = packagesByCategory.get(row.category_id);
      if (bucket) bucket.push(pkg);
      else packagesByCategory.set(row.category_id, [pkg]);
    }

    const categories = ((categoryResult.data ?? []) as CategoryRow[])
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        packages: packagesByCategory.get(row.id) ?? [],
      }))
      /* A tab that opens onto nothing is worse than no tab at all. */
      .filter((category) => category.packages.length > 0);

    const addons = ((addonResult.data ?? []) as AddonRow[]).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      priceIdr: row.price_idr,
      unit: row.unit,
      description: row.description,
    }));

    return { categories, addons };
  } catch (error: unknown) {
    console.error("pricelist_load_threw", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return emptyPricelist();
  }
}
