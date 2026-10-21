"use server";

/*
 * Pricelist CMS server actions (migration 0025).
 *
 * WHY THIS EXISTS
 * ---------------
 * The prices a client is quoted live in `pricelist_*`. Until now the only way to
 * change one was a SQL migration, so a price change shipped with a deploy. These
 * actions are the operator's write path; the public configurator reads the same
 * three tables through `src/lib/pricelist.ts`.
 *
 * REVALIDATION IS THE CONTRACT
 * ----------------------------
 * Every successful mutation calls `revalidatePricelist()`, which invalidates
 * BOTH `/pricelist` and `/admin/pricelist`. The public page is `force-dynamic`
 * today, but the cache invalidation is still required: the moment anyone removes
 * that flag — or a `fetch` inside the tree gets cached — a stale price page
 * silently quotes last week's number. One helper, called from every write, so
 * there is no per-action chance to forget half of it.
 *
 * GUARDS
 * ------
 * Every function calls `requireOps()` (rank >= 80), matching the RLS write
 * policy in 0025 (`private.has_role_rank(80)`). Reads use the same guard because
 * the CMS lists INACTIVE rows, which an anonymous visitor must never see.
 *
 * FAILURES ARE RETURNED, NOT THROWN
 * ---------------------------------
 * A duplicate slug, a negative price, or a category that still holds packages
 * are all things the operator can fix. Throwing turns them into an error
 * boundary and loses their edits. Authorization failures still throw, because
 * there is nothing to recover and a silent `{ ok: false }` would disguise a real
 * permission problem as a validation problem.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import type { Database } from "@/types/database";

export type PricelistCategoryRow = Database["public"]["Tables"]["pricelist_categories"]["Row"];
export type PricelistPackageRow = Database["public"]["Tables"]["pricelist_packages"]["Row"];
export type PricelistAddonRow = Database["public"]["Tables"]["pricelist_addons"]["Row"];

export type PricelistResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

// ── Validation ───────────────────────────────────────────────────────────────

const uuidSchema = z.uuid("ID tidak valid.");

const directionSchema = z.enum(["up", "down"], {
  error: "Arah perpindahan tidak dikenal.",
});

/** Mirrors the CHECK constraint on all three `slug` columns (0025). */
const slugSchema = z
  .string({ error: "Slug wajib diisi." })
  .trim()
  .min(1, "Slug wajib diisi.")
  .max(120, "Slug maksimal 120 karakter.")
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "Slug hanya boleh huruf kecil, angka, dan tanda hubung (contoh: graduation-photo).",
  );

const nameSchema = z
  .string({ error: "Nama wajib diisi." })
  .trim()
  .min(1, "Nama wajib diisi.")
  .max(160, "Nama maksimal 160 karakter.");

/*
 * Prices arrive from a text field, and Indonesian convention writes thousands
 * with dots: `350.000`, `Rp 1.350.000`. Rejecting those would make the operator
 * fight the form over a separator, so the separators are stripped here and the
 * NUMBER is validated — not the string. Everything non-digit is discarded, then
 * the integer rules still apply, so "abc" is a clear error rather than a zero.
 *
 * `ZodType<number, number | string>` is annotated explicitly because
 * `z.preprocess` otherwise infers its INPUT as `unknown`, and `unknown` inside
 * an object schema makes the exported `SavePackageInput` accept anything — the
 * compiler would stop catching a form that passed a Date where a price belongs.
 */
const priceSchema: z.ZodType<number, number | string> = z.preprocess(
  (value) => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const digits = value.replace(/[^0-9]/g, "");
      return digits === "" ? undefined : Number.parseInt(digits, 10);
    }
    return undefined;
  },
  z
    .number({ error: "Harga harus berupa angka." })
    .int("Harga harus bilangan bulat, tanpa desimal.")
    .min(0, "Harga tidak boleh negatif.")
    .max(2_000_000_000, "Harga melebihi batas yang wajar."),
);

/**
 * Crew and includes arrive as newline- or comma-separated text from the
 * operator, and are stored as `text[]`. Normalising here (trim, drop blanks)
 * keeps `[""]` — an empty textarea that was split once — out of the comparison
 * view, which counts entries.
 */
const textListSchema = z
  .array(z.string().max(200, "Satu poin maksimal 200 karakter."))
  .max(60, "Maksimal 60 poin per daftar.")
  .transform((rows) => rows.map((row) => row.trim()).filter((row) => row.length > 0));

const optionalText = (max: number) =>
  z
    .string({ error: "Teks tidak valid." })
    .max(max, `Maksimal ${max} karakter.`)
    .nullable()
    .optional();

const categorySchema = z.object({
  id: uuidSchema.optional(),
  slug: slugSchema,
  name: nameSchema,
  description: optionalText(600),
});

const packageSchema = z.object({
  id: uuidSchema.optional(),
  categoryId: uuidSchema,
  slug: slugSchema,
  name: nameSchema,
  priceIdr: priceSchema,
  duration: optionalText(80),
  maxPersons: z
    .number({ error: "Jumlah orang harus berupa angka." })
    .int("Jumlah orang harus bilangan bulat.")
    .min(1, "Jumlah orang minimal 1.")
    .max(1000, "Jumlah orang melebihi batas yang wajar.")
    .nullable()
    .optional(),
  crew: textListSchema.optional(),
  includes: textListSchema.optional(),
  badge: optionalText(40),
  notes: optionalText(600),
});

const addonSchema = z.object({
  id: uuidSchema.optional(),
  slug: slugSchema,
  name: nameSchema,
  priceIdr: priceSchema,
  unit: optionalText(60),
  description: optionalText(300),
});

export type SaveCategoryInput = z.input<typeof categorySchema>;
export type SavePackageInput = z.input<typeof packageSchema>;
export type SaveAddonInput = z.input<typeof addonSchema>;

/** Empty string means "clear the field", not "keep the old value". */
function nullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Data tidak valid.";
}

/**
 * The one place that knows which paths depend on the pricelist. Called from
 * every successful mutation — see the header note.
 */
function revalidatePricelist(): void {
  revalidatePath("/pricelist");
  revalidatePath("/admin/pricelist");
}

type SortRow = { id: string; sort_order: number };

/**
 * Computes the sort_order writes needed to move `id` one slot up or down.
 *
 * Returns `[]` when the row is already at the end of its scope — the buttons are
 * disabled there, so a stray call is a no-op rather than an error.
 *
 * TIES ARE RENUMBERED. Every row starts at the schema default `sort_order = 0`,
 * and two rows seeded with the same number are indistinguishable to the reader.
 * Swapping equal values would change nothing and the operator's click would look
 * broken, so a tie falls back to renumbering the whole scope from the order the
 * operator is actually looking at — and only the rows that move are written.
 */
function reorderPatch(rows: SortRow[], id: string, direction: "up" | "down"): SortRow[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return [];

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= rows.length) return [];

  const moving = rows[index];
  const neighbour = rows[target];

  if (moving.sort_order !== neighbour.sort_order) {
    return [
      { id: moving.id, sort_order: neighbour.sort_order },
      { id: neighbour.id, sort_order: moving.sort_order },
    ];
  }

  const swapped = [...rows];
  [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
  return swapped
    .map((row, position) => ({ id: row.id, sort_order: position + 1 }))
    .filter((row, position) => swapped[position].sort_order !== row.sort_order);
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** Every category, archived ones included. The public read filters those out. */
export async function listCategories(): Promise<PricelistCategoryRow[]> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("pricelist_categories")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  /*
   * Thrown, not swallowed into []. An empty list renders "belum ada kategori",
   * which would hide a broken query behind a plausible empty state.
   */
  if (error) throw new Error(`Gagal memuat kategori pricelist: ${error.message}`);
  return data ?? [];
}

/** Every package, archived ones included, in display order within its category. */
export async function listPackages(): Promise<PricelistPackageRow[]> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("pricelist_packages")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Gagal memuat paket pricelist: ${error.message}`);
  return data ?? [];
}

/** Every add-on, archived ones included. */
export async function listAddons(): Promise<PricelistAddonRow[]> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("pricelist_addons")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Gagal memuat add-on pricelist: ${error.message}`);
  return data ?? [];
}

/**
 * How many consultation leads reference each package, keyed by package id.
 *
 * The package tab disables Delete for a referenced row and says how many leads
 * depend on it. `deletePackage` re-checks on its own — this read exists so the
 * operator learns the reason BEFORE clicking, not so the guard can be skipped.
 *
 * One grouped read rather than a count per package: sixteen packages would
 * otherwise mean sixteen round trips on every page load.
 */
export async function listPackageLeadCounts(): Promise<Record<string, number>> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("inquiries")
    .select("selected_package_id")
    .not("selected_package_id", "is", null);

  if (error) throw new Error(`Gagal memuat pemakaian paket: ${error.message}`);

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const id = row.selected_package_id;
    if (!id) continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

// ── Category writes ──────────────────────────────────────────────────────────

/** Creates when `id` is absent, updates when present. */
export async function saveCategory(
  input: SaveCategoryInput,
): Promise<PricelistResult<PricelistCategoryRow>> {
  const { supabase } = await requireOps();

  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const value = parsed.data;

  const patch = {
    slug: value.slug,
    name: value.name,
    description: nullable(value.description),
  };

  if (value.id) {
    const { data, error } = await supabase
      .from("pricelist_categories")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", value.id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Slug "${value.slug}" sudah dipakai kategori lain.` };
      }
      return { ok: false, error: `Gagal menyimpan kategori: ${error.message}` };
    }
    if (!data) return { ok: false, error: "Kategori tidak ditemukan." };

    revalidatePricelist();
    return { ok: true, data };
  }

  /*
   * New rows go to the end of the list. Computing `max + 1` here rather than
   * relying on the default 0 keeps a freshly created category from landing in
   * the middle of the operator's carefully ordered tabs.
   */
  const { data: last } = await supabase
    .from("pricelist_categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("pricelist_categories")
    .insert({ ...patch, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Slug "${value.slug}" sudah dipakai kategori lain.` };
    }
    return { ok: false, error: `Gagal membuat kategori: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Kategori gagal dibuat." };

  revalidatePricelist();
  return { ok: true, data };
}

/** Shows or hides a category on the public page. Archive is the safe alternative to delete. */
export async function setCategoryActive(id: string, isActive: boolean): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID kategori tidak valid." };

  const { error } = await supabase
    .from("pricelist_categories")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: `Gagal mengubah status kategori: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}

/** Swaps sort_order with the neighbouring category. */
export async function reorderCategory(
  id: string,
  direction: "up" | "down",
): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID kategori tidak valid." };

  const dir = directionSchema.safeParse(direction);
  if (!dir.success) return { ok: false, error: "Arah perpindahan tidak dikenal." };

  const { data: siblings, error } = await supabase
    .from("pricelist_categories")
    .select("id, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return { ok: false, error: `Gagal membaca urutan kategori: ${error.message}` };

  const patch = reorderPatch(siblings ?? [], id, dir.data);
  if (patch.length === 0) return { ok: true };

  const results = await Promise.all(
    patch.map((row) =>
      supabase
        .from("pricelist_categories")
        .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
        .eq("id", row.id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    return { ok: false, error: `Gagal mengubah urutan kategori: ${failed.error.message}` };
  }

  revalidatePricelist();
  return { ok: true };
}

/**
 * Deletes a category, but ONLY when it holds no packages.
 *
 * The FK in 0025 is `on delete cascade`, so the database would happily delete a
 * category and take every package inside it — sixteen rows of pricing gone on a
 * single click with no undo. Refusing here makes the operator acknowledge what
 * they are about to remove.
 */
export async function deleteCategory(id: string): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID kategori tidak valid." };

  const { data: existing, error: readError } = await supabase
    .from("pricelist_categories")
    .select("slug, name")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca kategori: ${readError.message}` };
  if (!existing) return { ok: false, error: "Kategori tidak ditemukan." };

  const { count, error: countError } = await supabase
    .from("pricelist_packages")
    .select("id", { count: "exact", head: true })
    .eq("category_id", id);

  if (countError) {
    return { ok: false, error: `Gagal memeriksa paket di kategori ini: ${countError.message}` };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Kategori "${existing.name}" masih berisi ${count} paket. Pindahkan paket ke kategori lain atau arsipkan paketnya dulu, baru hapus kategorinya.`,
    };
  }

  const { error } = await supabase.from("pricelist_categories").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus kategori: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}

// ── Package writes ───────────────────────────────────────────────────────────

/** Creates when `id` is absent, updates when present. `categoryId` may be changed. */
export async function savePackage(
  input: SavePackageInput,
): Promise<PricelistResult<PricelistPackageRow>> {
  const { supabase } = await requireOps();

  const parsed = packageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const value = parsed.data;

  const patch = {
    category_id: value.categoryId,
    slug: value.slug,
    name: value.name,
    price_idr: value.priceIdr,
    duration: nullable(value.duration),
    max_persons: value.maxPersons ?? null,
    crew: value.crew ?? [],
    includes: value.includes ?? [],
    badge: nullable(value.badge),
    notes: nullable(value.notes),
  };

  if (value.id) {
    const { data, error } = await supabase
      .from("pricelist_packages")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", value.id)
      .select("*")
      .maybeSingle();

    if (error) return { ok: false, error: packageWriteError(error, value.slug, "menyimpan") };
    if (!data) return { ok: false, error: "Paket tidak ditemukan." };

    revalidatePricelist();
    return { ok: true, data };
  }

  const { data: last } = await supabase
    .from("pricelist_packages")
    .select("sort_order")
    .eq("category_id", value.categoryId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("pricelist_packages")
    .insert({ ...patch, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("*")
    .maybeSingle();

  if (error) return { ok: false, error: packageWriteError(error, value.slug, "membuat") };
  if (!data) return { ok: false, error: "Paket gagal dibuat." };

  revalidatePricelist();
  return { ok: true, data };
}

/** Turns a package write failure into something the operator can act on. */
function packageWriteError(
  error: { code?: string; message: string },
  slug: string,
  verb: "menyimpan" | "membuat",
): string {
  if (error.code === "23505") return `Slug "${slug}" sudah dipakai di kategori ini.`;
  if (error.code === "23503") return "Kategori yang dipilih tidak ditemukan. Muat ulang halaman.";
  return `Gagal ${verb} paket: ${error.message}`;
}

/** Shows or hides a package on the public page. */
export async function setPackageActive(id: string, isActive: boolean): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID paket tidak valid." };

  const { error } = await supabase
    .from("pricelist_packages")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: `Gagal mengubah status paket: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}

/** Swaps sort_order with the neighbouring package INSIDE THE SAME CATEGORY. */
export async function reorderPackage(
  id: string,
  direction: "up" | "down",
): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID paket tidak valid." };

  const dir = directionSchema.safeParse(direction);
  if (!dir.success) return { ok: false, error: "Arah perpindahan tidak dikenal." };

  const { data: current, error: readError } = await supabase
    .from("pricelist_packages")
    .select("category_id")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca paket: ${readError.message}` };
  if (!current) return { ok: false, error: "Paket tidak ditemukan." };

  const { data: siblings, error } = await supabase
    .from("pricelist_packages")
    .select("id, sort_order")
    .eq("category_id", current.category_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return { ok: false, error: `Gagal membaca urutan paket: ${error.message}` };

  const patch = reorderPatch(siblings ?? [], id, dir.data);
  if (patch.length === 0) return { ok: true };

  const results = await Promise.all(
    patch.map((row) =>
      supabase
        .from("pricelist_packages")
        .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
        .eq("id", row.id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    return { ok: false, error: `Gagal mengubah urutan paket: ${failed.error.message}` };
  }

  revalidatePricelist();
  return { ok: true };
}

/**
 * Deletes a package, unless a consultation lead chose it.
 *
 * `inquiries.selected_package_id` is `on delete set null`, so the database will
 * NOT stop this — it would quietly blank the package on every historical lead
 * and the operator would lose which tier was quoted. Archive instead: `is_active
 * = false` removes it from the public configurator while keeping the record.
 */
export async function deletePackage(id: string): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID paket tidak valid." };

  const { data: existing, error: readError } = await supabase
    .from("pricelist_packages")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca paket: ${readError.message}` };
  if (!existing) return { ok: false, error: "Paket tidak ditemukan." };

  const { count, error: countError } = await supabase
    .from("inquiries")
    .select("id", { count: "exact", head: true })
    .eq("selected_package_id", id);

  if (countError) {
    return { ok: false, error: `Gagal memeriksa lead yang memakai paket ini: ${countError.message}` };
  }

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      error: `Paket "${existing.name}" dipakai oleh ${count} lead konsultasi. Arsipkan paket ini (matikan status aktif) alih-alih menghapusnya, supaya riwayat penawaran tetap utuh.`,
    };
  }

  const { error } = await supabase.from("pricelist_packages").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus paket: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}

// ── Add-on writes ────────────────────────────────────────────────────────────

/** Creates when `id` is absent, updates when present. */
export async function saveAddon(
  input: SaveAddonInput,
): Promise<PricelistResult<PricelistAddonRow>> {
  const { supabase } = await requireOps();

  const parsed = addonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const value = parsed.data;

  const patch = {
    slug: value.slug,
    name: value.name,
    price_idr: value.priceIdr,
    unit: nullable(value.unit),
    description: nullable(value.description),
  };

  if (value.id) {
    const { data, error } = await supabase
      .from("pricelist_addons")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", value.id)
      .select("*")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `Slug "${value.slug}" sudah dipakai add-on lain.` };
      }
      return { ok: false, error: `Gagal menyimpan add-on: ${error.message}` };
    }
    if (!data) return { ok: false, error: "Add-on tidak ditemukan." };

    revalidatePricelist();
    return { ok: true, data };
  }

  const { data: last } = await supabase
    .from("pricelist_addons")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("pricelist_addons")
    .insert({ ...patch, sort_order: (last?.sort_order ?? 0) + 1 })
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Slug "${value.slug}" sudah dipakai add-on lain.` };
    }
    return { ok: false, error: `Gagal membuat add-on: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Add-on gagal dibuat." };

  revalidatePricelist();
  return { ok: true, data };
}

/** Shows or hides an add-on on the public page. */
export async function setAddonActive(id: string, isActive: boolean): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID add-on tidak valid." };

  const { error } = await supabase
    .from("pricelist_addons")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: `Gagal mengubah status add-on: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}

/** Swaps sort_order with the neighbouring add-on. */
export async function reorderAddon(
  id: string,
  direction: "up" | "down",
): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID add-on tidak valid." };

  const dir = directionSchema.safeParse(direction);
  if (!dir.success) return { ok: false, error: "Arah perpindahan tidak dikenal." };

  const { data: siblings, error } = await supabase
    .from("pricelist_addons")
    .select("id, sort_order")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) return { ok: false, error: `Gagal membaca urutan add-on: ${error.message}` };

  const patch = reorderPatch(siblings ?? [], id, dir.data);
  if (patch.length === 0) return { ok: true };

  const results = await Promise.all(
    patch.map((row) =>
      supabase
        .from("pricelist_addons")
        .update({ sort_order: row.sort_order, updated_at: new Date().toISOString() })
        .eq("id", row.id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    return { ok: false, error: `Gagal mengubah urutan add-on: ${failed.error.message}` };
  }

  revalidatePricelist();
  return { ok: true };
}

/**
 * Deletes an add-on.
 *
 * No reference check is needed: `inquiries.selected_addons` is a jsonb SNAPSHOT
 * of `{ id, name, price_idr }` taken at submission time, not a foreign key. A
 * historical lead keeps the name and price it was quoted after the add-on row is
 * gone — which is the behaviour a quotation archive should have.
 */
export async function deleteAddon(id: string): Promise<PricelistResult> {
  const { supabase } = await requireOps();
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: "ID add-on tidak valid." };

  const { data: existing, error: readError } = await supabase
    .from("pricelist_addons")
    .select("name")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca add-on: ${readError.message}` };
  if (!existing) return { ok: false, error: "Add-on tidak ditemukan." };

  const { error } = await supabase.from("pricelist_addons").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus add-on: ${error.message}` };

  revalidatePricelist();
  return { ok: true };
}
