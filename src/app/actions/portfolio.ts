"use server";

/*
 * Portfolio CMS server actions.
 *
 * WHY THE GEOMETRY LIVES ELSEWHERE
 * --------------------------------
 * A `"use server"` module may export only async functions, so every pure helper
 * (`moveBlock`, `normaliseLayout`, the template array) lives in
 * `src/lib/portfolio/layout.ts`. Importing them into a Client Component from
 * here fails the build with "A 'use server' file can only export async
 * functions, found object".
 *
 * GUARDS
 * ------
 * Every mutation calls `requireOps()` (rank >= 80), matching the RLS write
 * policy in 0026 (`private.has_role_rank(80)`). The read used by the public
 * renderer is deliberately unguarded: it cannot be, because an anonymous
 * visitor has no session — and it does not need to be, because
 * `portfolio_pages_read` already restricts anon to `status = 'published'`.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import { createServerSupabase } from "@/lib/supabase/server";
import { normaliseLayout, findFirstPhotoUrl, trimTrailingEmptyRows } from "@/lib/portfolio/layout";
import {
  PORTFOLIO_CATEGORIES,
  normalisePortfolioTags,
  type PortfolioCategory,
} from "@/lib/portfolio/category";
import type { Database } from "@/types/database";

type GeneratedPageRow = Database["public"]["Tables"]["portfolio_pages"]["Row"];

/*
 * `category` and `tags` were added by migration 0028 and ARE live in the
 * database, but `src/types/database.ts` has not been regenerated yet. Widening
 * the generated row here — instead of pretending the columns do not exist —
 * keeps every reader of this module honest. When the types are regenerated this
 * intersection collapses to the generated row and can be deleted; the two write
 * casts below become unnecessary with it.
 */
export type PortfolioPageRow = GeneratedPageRow & {
  category: PortfolioCategory | null;
  tags: string[];
};
export type PortfolioSectionRow = Database["public"]["Tables"]["portfolio_sections"]["Row"];

/*
 * A `from()` generic, not a cast at every call site. `RejectExcessProperties`
 * in postgrest-js turns an unknown key in a write payload into `never`, so a
 * stale generated type does not merely hide `category` from reads — it makes
 * writing it a compile error. Declaring the widened relation once is the only
 * version of this that does not need `as never` scattered through the module.
 */
type PortfolioPagesRelation = {
  Row: PortfolioPageRow;
  Insert: Database["public"]["Tables"]["portfolio_pages"]["Insert"] & {
    category?: PortfolioCategory | null;
    tags?: string[];
  };
  Update: Database["public"]["Tables"]["portfolio_pages"]["Update"] & {
    category?: PortfolioCategory | null;
    tags?: string[];
  };
  Relationships: [];
};

const portfolioPages = <T extends SupabaseClient<Database>>(supabase: T) =>
  supabase.from<"portfolio_pages", PortfolioPagesRelation>("portfolio_pages");

export type PortfolioPageBundle = {
  page: PortfolioPageRow;
  sections: PortfolioSectionRow[];
};

/**
 * Finds the first photo block's public URL across all sections of a page.
 * Used as automatic fallback when an admin leaves cover_url empty.
 */
async function findPageCoverFallback(
  supabase: SupabaseClient<Database>,
  pageId: string,
): Promise<string | null> {
  const { data: sections } = await supabase
    .from("portfolio_sections")
    .select("layout")
    .eq("page_id", pageId)
    .order("sort_order", { ascending: true });

  for (const s of sections ?? []) {
    const photo = findFirstPhotoUrl(s.layout);
    if (photo) return photo;
  }
  return null;
}

/**
 * Shared result shape. Failures are RETURNED, not thrown, for anything the
 * operator can fix (bad slug, duplicate slug, missing row): a thrown error
 * becomes an error boundary and loses their edits. Authorization failures still
 * throw, because there is nothing to recover and a silent `{ok:false}` would
 * hide a real permission problem.
 */
export type PortfolioResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const uuidSchema = z.uuid();
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  // Mirrors the CHECK constraint on portfolio_pages.slug. Validating here turns
  // a Postgres constraint violation into a message the operator can act on.
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug hanya boleh huruf kecil, angka, dan tanda hubung.");

const pageInputSchema = z.object({
  id: uuidSchema.optional(),
  slug: slugSchema,
  title: z.string().trim().min(1).max(200),
  summary: z.string().max(2000).nullable().optional(),
  seoTitle: z.string().max(200).nullable().optional(),
  seoDescription: z.string().max(400).nullable().optional(),
  coverUrl: z.string().max(2048).nullable().optional(),
  /*
   * Empty string is the "Tanpa kategori" option in the admin select, and it
   * means NULL — not a sixth category. Validating against the same five values
   * as `portfolio_pages_category_check` turns a stale client bundle into a
   * message the operator can act on instead of a raw check_violation.
   */
  category: z
    .union([z.enum(PORTFOLIO_CATEGORIES), z.literal("")], {
      error: "Kategori tidak dikenal.",
    })
    .nullish(),
  tags: z.array(z.string(), { error: "Tag tidak valid." }).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const sectionInputSchema = z.object({
  id: uuidSchema.optional(),
  pageId: uuidSchema,
  kind: z.enum(["canvas", "hero", "text", "gallery"]),
  layout: z.unknown(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/** Empty string means "clear the field", not "keep the old value". */
function nullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// ── Reads ───────────────────────────────────────────────────────────────────

/** Every page, drafts included. Admin list only. */
export async function listPortfolioPages(): Promise<PortfolioPageRow[]> {
  const { supabase } = await requireOps();

  const { data, error } = await portfolioPages(supabase)
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  /*
   * Thrown rather than returned as an empty list. An admin list that renders
   * "no pages yet" when the query actually failed is the failure mode
   * `EmptyState` was written to end — an honest error beats a confident zero.
   */
  if (error) throw new Error(`Gagal memuat halaman portofolio: ${error.message}`);
  return data ?? [];
}

/** One page plus its sections, for the editor. Admin only. */
export async function getPortfolioPage(id: string): Promise<PortfolioPageBundle | null> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return null;

  const { data: page, error: pageError } = await portfolioPages(supabase)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (pageError) throw new Error(`Gagal memuat halaman: ${pageError.message}`);
  if (!page) return null;

  const { data: sections, error: sectionError } = await supabase
    .from("portfolio_sections")
    .select("*")
    .eq("page_id", id)
    .order("sort_order", { ascending: true });

  if (sectionError) throw new Error(`Gagal memuat bagian: ${sectionError.message}`);

  return { page, sections: sections ?? [] };
}

/**
 * The public read. NO GUARD, BY DESIGN.
 *
 * Anonymous visitors have no session to check, and RLS already answers the only
 * question that matters: `portfolio_pages_read` shows a row to `anon` only when
 * `status = 'published'`. The explicit `status` filter is duplicated here so
 * the route behaves identically for a signed-in admin (whose RLS predicate is
 * wider) — a public URL must mean "published", whoever is looking.
 */
export async function getPublishedPortfolioPage(
  slug: string,
): Promise<PortfolioPageBundle | null> {
  if (!slugSchema.safeParse(slug).success) return null;

  const supabase = await createServerSupabase();

  const { data: page } = await portfolioPages(supabase)
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();

  if (!page) return null;

  const { data: sections } = await supabase
    .from("portfolio_sections")
    .select("*")
    .eq("page_id", page.id)
    .order("sort_order", { ascending: true });

  return { page, sections: sections ?? [] };
}

/**
 * Every published page, for the public index.
 *
 * Same guard-free posture as `getPublishedPortfolioPage`: RLS shows `anon` only
 * published rows, and the explicit filter keeps a signed-in admin's wider
 * predicate from leaking drafts into the public list. Returns only the columns
 * the index actually renders — no SEO fields, no layout blobs.
 *
 * `category` is what the public filter keys on, so it is part of this contract
 * rather than a detail the page re-derives.
 */
export type PublishedPortfolioPage = Pick<
  PortfolioPageRow,
  "id" | "slug" | "title" | "summary" | "cover_url" | "sort_order" | "category" | "tags"
>;

export async function listPublishedPortfolioPages(): Promise<PublishedPortfolioPage[]> {
  const supabase = await createServerSupabase();

  const { data, error } = await portfolioPages(supabase)
    .select("id, slug, title, summary, cover_url, sort_order, category, tags")
    .eq("status", "published")
    .order("sort_order", { ascending: true })
    .order("published_at", { ascending: false });

  /*
   * Returned as an empty list, not thrown: the public index keeps its static
   * gallery when the CMS read fails, and a thrown error there would take the
   * whole page down.
   *
   * But it is LOGGED. This used to swallow the error entirely, which is how a
   * broken RLS predicate on `portfolio_pages` stayed invisible for so long: the
   * public page rendered "nothing published yet" — a plausible, confident zero
   * — while every anonymous request was actually being refused.
   */
  if (error) {
    console.error("portfolio_published_list_failed", { code: error.code });
    return [];
  }

  return data ?? [];
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Creates or updates a page. `id` absent means create.
 *
 * A new page is always created as a DRAFT: publishing is a separate, deliberate
 * action (`publishPortfolioPage`), so a half-built page can never appear on the
 * public site because its metadata happened to save first.
 */
export async function savePortfolioPage(
  input: z.input<typeof pageInputSchema>,
): Promise<PortfolioResult<PortfolioPageRow>> {
  const { supabase } = await requireOps();

  const parsed = pageInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data halaman tidak valid." };
  }
  const value = parsed.data;

  /*
   * EVERY optional column is written only when the caller sent it.
   *
   * WHY NOT `summary: nullable(value.summary)` UNCONDITIONALLY
   * --------------------------------------------------------
   * That was fine while the only caller was the full metadata form, but this
   * action is now also the "save category and tags" path from the layout
   * editor. `nullable(undefined)` returns `null`, so a settings-only save would
   * have silently erased the page's summary, SEO fields and cover image — the
   * exact data the public card renders.
   *
   * The rule is now uniform and explicit: absent key = leave the column alone,
   * `null` or `""` = clear it. That distinction is what makes a partial update
   * safe, and it is why `category: ""` (the "Tanpa kategori" option) can clear
   * the column while an omitted category cannot.
   */
  /*
   * Automatic Fallback Logic:
   * If coverUrl is provided as a non-empty string, use it.
   * If coverUrl is provided as empty/null and the page already has sections,
   * fall back to the first photo block across its sections.
   */
  let resolvedCoverUrl: string | null | undefined = undefined;
  if (value.coverUrl !== undefined) {
    const cleaned = nullable(value.coverUrl);
    if (cleaned) {
      resolvedCoverUrl = cleaned;
    } else if (value.id) {
      resolvedCoverUrl = await findPageCoverFallback(supabase, value.id);
    } else {
      resolvedCoverUrl = null;
    }
  }

  const patch = {
    slug: value.slug,
    title: value.title,
    ...(value.summary === undefined ? {} : { summary: nullable(value.summary) }),
    ...(value.seoTitle === undefined ? {} : { seo_title: nullable(value.seoTitle) }),
    ...(value.seoDescription === undefined
      ? {}
      : { seo_description: nullable(value.seoDescription) }),
    ...(resolvedCoverUrl === undefined ? {} : { cover_url: resolvedCoverUrl }),
    ...(value.category === undefined
      ? {}
      : { category: value.category === "" ? null : value.category }),
    /*
     * Normalised here, not in the form. The admin field is one comma-separated
     * string, and two operators typing "Outdoor" and "outdoor" must not become
     * two tags; doing it server-side means the rule holds for any caller.
     */
    ...(value.tags === undefined ? {} : { tags: normalisePortfolioTags(value.tags) }),
    ...(value.sortOrder === undefined ? {} : { sort_order: value.sortOrder }),
  };

  const query = value.id
    ? portfolioPages(supabase).update(patch).eq("id", value.id).select("*").maybeSingle()
    : portfolioPages(supabase).insert(patch).select("*").maybeSingle();

  const { data, error } = await query;

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Slug "${value.slug}" sudah dipakai halaman lain.` };
    }
    return { ok: false, error: `Gagal menyimpan halaman: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Halaman tidak ditemukan." };

  revalidatePath("/admin/portfolio");
  revalidatePath(`/admin/portfolio/${data.id}`);
  revalidatePath(`/portfolio/${data.slug}`);

  return { ok: true, data };
}

/**
 * Creates or updates one section's layout document.
 *
 * `normaliseLayout` runs BEFORE the write. The database trigger in 0026 rejects
 * out-of-bounds blocks outright, so a pointer drag that overshot the grid would
 * otherwise surface as a raw `check_violation` string in the editor. Clamping
 * first means the editor saves what the operator can see, and the trigger
 * remains the backstop rather than the first line of defence.
 */
export async function savePortfolioSection(
  input: z.input<typeof sectionInputSchema>,
): Promise<PortfolioResult<PortfolioSectionRow>> {
  const { supabase } = await requireOps();

  const parsed = sectionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Bagian tidak valid." };
  }
  const value = parsed.data;
  const layout = trimTrailingEmptyRows(normaliseLayout(value.layout));

  const patch = {
    page_id: value.pageId,
    kind: value.kind,
    layout,
    ...(value.sortOrder === undefined ? {} : { sort_order: value.sortOrder }),
  };

  /*
   * An update carries no `page_id` in its payload: re-writing it would let a
   * caller move a section into a different page (and past that page's draft
   * gate) with the same call that saves its geometry.
   */
  const { page_id: _pageId, ...updatePatch } = patch;

  /*
   * `LayoutDoc` is an interface, and an interface has no implicit index
   * signature, so it is not assignable to the `Record<string, unknown>` the
   * generated jsonb column type expects. Serialising it at this boundary is the
   * honest fix: the value crossing into Postgres IS plain JSON, not a typed
   * object.
   */
  const updateRow = {
    ...updatePatch,
    layout: updatePatch.layout as unknown as Record<string, unknown>,
  };
  const insertRow = {
    ...patch,
    layout: patch.layout as unknown as Record<string, unknown>,
  };

  const query = value.id
    ? supabase
        .from("portfolio_sections")
        .update(updateRow)
        .eq("id", value.id)
        .eq("page_id", value.pageId)
        .select("*")
        .maybeSingle()
    : supabase.from("portfolio_sections").insert(insertRow).select("*").maybeSingle();

  const { data, error } = await query;

  if (error) return { ok: false, error: `Gagal menyimpan bagian: ${error.message}` };
  if (!data) return { ok: false, error: "Bagian tidak ditemukan." };

  // Fallback: If page has no cover_url, populate it from the first photo block
  try {
    const { data: pageRow } = await portfolioPages(supabase)
      .select("cover_url, slug")
      .eq("id", value.pageId)
      .maybeSingle();

    if (pageRow && !pageRow.cover_url) {
      let photoUrl = findFirstPhotoUrl(layout);
      if (!photoUrl) {
        photoUrl = await findPageCoverFallback(supabase, value.pageId);
      }
      if (photoUrl) {
        await portfolioPages(supabase)
          .update({ cover_url: photoUrl })
          .eq("id", value.pageId);
        revalidatePath("/admin/portfolio");
        revalidatePath(`/admin/portfolio/${value.pageId}`);
        revalidatePath(`/portfolio/${pageRow.slug}`);
        revalidatePath("/portfolio");
      }
    }
  } catch (err) {
    console.warn("cover_url_fallback_check_failed", { err });
  }

  revalidatePath(`/admin/portfolio/${value.pageId}`);
  return { ok: true, data };
}

/** Deletes a section from a page. Used when removing empty or unwanted sections. */
export async function deletePortfolioSection(id: string): Promise<PortfolioResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID bagian tidak valid." };

  const { data: existing } = await supabase
    .from("portfolio_sections")
    .select("page_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "Bagian tidak ditemukan." };

  const { error } = await supabase.from("portfolio_sections").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus bagian: ${error.message}` };

  revalidatePath(`/admin/portfolio/${existing.page_id}`);
  return { ok: true };
}

/** Flips a page to published and stamps the first publish time. */
export async function publishPortfolioPage(id: string): Promise<PortfolioResult<PortfolioPageRow>> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID halaman tidak valid." };
  const { data: current, error: readError } = await portfolioPages(supabase)
    .select("published_at, slug, cover_url")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca halaman: ${readError.message}` };
  if (!current) return { ok: false, error: "Halaman tidak ditemukan." };

  let coverUrlToSet = current.cover_url;
  if (!coverUrlToSet) {
    coverUrlToSet = await findPageCoverFallback(supabase, id);
  }

  const { data, error } = await portfolioPages(supabase)
    .update({
      status: "published",
      /*
       * Preserved on re-publish. `published_at` is the date the work was shown
       * to the world; overwriting it on every toggle would rewrite history and
       * silently reorder any feed that sorts by it.
       */
      published_at: current.published_at ?? new Date().toISOString(),
      ...(coverUrlToSet ? { cover_url: coverUrlToSet } : {}),
    })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: `Gagal menerbitkan halaman: ${error.message}` };
  if (!data) return { ok: false, error: "Halaman tidak ditemukan." };

  revalidatePath("/admin/portfolio");
  revalidatePath(`/admin/portfolio/${id}`);
  revalidatePath("/portfolio");
  revalidatePath(`/portfolio/${data.slug}`);
  return { ok: true, data };
}

/**
 * Returns a page to draft. `published_at` is CLEARED: leaving it behind would
 * make an unpublished page look published to anything that reads the timestamp
 * instead of the status.
 */
export async function unpublishPortfolioPage(
  id: string,
): Promise<PortfolioResult<PortfolioPageRow>> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID halaman tidak valid." };

  const { data, error } = await portfolioPages(supabase)
    .update({ status: "draft", published_at: null })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: `Gagal menarik halaman: ${error.message}` };
  if (!data) return { ok: false, error: "Halaman tidak ditemukan." };

  revalidatePath("/admin/portfolio");
  revalidatePath(`/admin/portfolio/${id}`);
  revalidatePath(`/portfolio/${data.slug}`);
  return { ok: true, data };
}

/** Deletes a page. Sections go with it via `on delete cascade` in 0026. */
export async function deletePortfolioPage(id: string): Promise<PortfolioResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID halaman tidak valid." };

  const { data: existing, error: readError } = await supabase
    .from("portfolio_pages")
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca halaman: ${readError.message}` };
  if (!existing) return { ok: false, error: "Halaman tidak ditemukan." };

  const { error } = await supabase.from("portfolio_pages").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus halaman: ${error.message}` };

  revalidatePath("/admin/portfolio");
  revalidatePath(`/portfolio/${existing.slug}`);
  return { ok: true };
}
