"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deletePackage,
  reorderPackage,
  savePackage,
  setPackageActive,
  type PricelistCategoryRow,
  type PricelistPackageRow,
} from "@/app/actions/admin-pricelist";
import { formatRupiahInput, parseTextList, slugify } from "@/lib/pricelist-form";
import {
  ActiveToggle,
  ErrorStrip,
  Field,
  GhostButton,
  IconButton,
  PrimaryButton,
  RowIdentity,
  Select,
  TextArea,
  TextInput,
} from "@/components/admin/pricelist/ui";
import { useActionRunner } from "@/components/admin/pricelist/use-action-runner";

type Draft = {
  id?: string;
  categoryId: string;
  slug: string;
  name: string;
  /** Kept as TEXT: the operator types `350.000` and the separators are stripped on save. */
  price: string;
  duration: string;
  maxPersons: string;
  badge: string;
  crew: string;
  includes: string;
  notes: string;
};

/**
 * Package tab: every field the public comparison view renders.
 *
 * WHY `crew` AND `includes` ARE TEXTAREAS
 * ---------------------------------------
 * They are `text[]` in the database. The operator's real input is a paragraph of
 * deliverables copied out of a quotation, so a textarea with one entry per line
 * (comma also accepted) is the honest control. `parseTextList` normalises on
 * save — trimming and dropping blanks — so the stored array never contains "".
 *
 * WHY THE ROW IS A CARD, NOT A TABLE ROW
 * --------------------------------------
 * A package carries eleven values, several of them lists. Six of them in a table
 * cell is unreadable at a glance; the operator needs price and duration side by
 * side while scanning, which a two-column card gives without a horizontal
 * scrollbar.
 */
export function PackagePanel({
  packages,
  categories,
  leadCounts,
}: {
  packages: PricelistPackageRow[];
  categories: PricelistCategoryRow[];
  /** inquiry rows per package id — used to explain why a delete is refused. */
  leadCounts: Record<string, number>;
}) {
  const { run, pending, pendingKey, error } = useActionRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories) map.set(category.id, category.name);
    return map;
  }, [categories]);

  /*
   * Grouped by category, in category sort order, then package sort order. The
   * page passes both lists already ordered, so a single pass preserves it.
   */
  const grouped = useMemo(() => {
    const buckets = new Map<string, PricelistPackageRow[]>();
    for (const pkg of packages) {
      const bucket = buckets.get(pkg.category_id);
      if (bucket) bucket.push(pkg);
      else buckets.set(pkg.category_id, [pkg]);
    }
    return categories
      .map((category) => ({ category, rows: buckets.get(category.id) ?? [] }))
      .filter((group) => group.rows.length > 0);
  }, [packages, categories]);

  const visibleGroups =
    categoryFilter === "ALL"
      ? grouped
      : grouped.filter((group) => group.category.id === categoryFilter);

  const startCreate = () => {
    setSlugTouched(false);
    setDraft({
      categoryId: categoryFilter !== "ALL" ? categoryFilter : (categories[0]?.id ?? ""),
      slug: "",
      name: "",
      price: "",
      duration: "",
      maxPersons: "",
      badge: "",
      crew: "",
      includes: "",
      notes: "",
    });
  };

  const startEdit = (row: PricelistPackageRow) => {
    setSlugTouched(true);
    setDraft({
      id: row.id,
      categoryId: row.category_id,
      slug: row.slug,
      name: row.name,
      price: formatRupiahInput(row.price_idr),
      duration: row.duration ?? "",
      maxPersons: row.max_persons == null ? "" : String(row.max_persons),
      badge: row.badge ?? "",
      crew: row.crew.join("\n"),
      includes: row.includes.join("\n"),
      notes: row.notes ?? "",
    });
  };

  const submit = () => {
    if (!draft) return;
    run(draft.id ?? "new-package", () =>
      savePackage({
        id: draft.id,
        categoryId: draft.categoryId,
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        /*
         * The RAW field value goes to the action. Its Zod schema strips
         * thousands separators and validates the integer, so an empty or
         * non-numeric field comes back as "Harga harus berupa angka." instead
         * of a zero this form silently invented.
         */
        priceIdr: draft.price,
        duration: draft.duration.trim() || null,
        maxPersons: draft.maxPersons.trim() === "" ? null : Number(draft.maxPersons),
        crew: parseTextList(draft.crew),
        includes: parseTextList(draft.includes),
        badge: draft.badge.trim() || null,
        notes: draft.notes.trim() || null,
      }),
      () => setDraft(null),
    );
  };

  const busyKey = draft ? (draft.id ?? "new-package") : null;

  return (
    <div className="space-y-3">
      <ErrorStrip message={error} />

      <div className="flex flex-wrap items-center gap-2">
        {draft ? null : (
          <PrimaryButton onClick={startCreate} disabled={categories.length === 0}>
            <Plus size={14} /> Paket baru
          </PrimaryButton>
        )}
        <div className="flex items-center gap-1.5">
          <label htmlFor="pkg-filter" className="text-[11px] font-medium text-iron">
            Kategori
          </label>
          <Select
            id="pkg-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="w-auto py-1.5 text-xs"
          >
            <option value="ALL">Semua ({packages.length})</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        {categories.length === 0 ? (
          <p className="text-[11px] text-ember">
            Buat kategori dulu — paket harus punya kategori.
          </p>
        ) : null}
      </div>

      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-3 rounded-[36px] border border-cloud bg-snow p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nama paket" htmlFor="pkg-name">
              <TextInput
                id="pkg-name"
                value={draft.name}
                required
                maxLength={160}
                autoFocus
                onChange={(event) => {
                  const name = event.target.value;
                  setDraft((prev) =>
                    prev
                      ? { ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }
                      : prev,
                  );
                }}
              />
            </Field>
            <Field
              label="Slug"
              htmlFor="pkg-slug"
              hint="Unik di dalam kategori ini."
            >
              <TextInput
                id="pkg-slug"
                value={draft.slug}
                required
                maxLength={120}
                className="font-mono"
                onChange={(event) => {
                  setSlugTouched(true);
                  const slug = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, slug } : prev));
                }}
              />
            </Field>
            <Field label="Kategori" htmlFor="pkg-category" hint="Pindah tab = pindah kategori.">
              <Select
                id="pkg-category"
                value={draft.categoryId}
                required
                onChange={(event) => {
                  const categoryId = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, categoryId } : prev));
                }}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Harga (Rp)" htmlFor="pkg-price" hint="Angka saja; titik pemisah diabaikan.">
              <TextInput
                id="pkg-price"
                inputMode="numeric"
                value={draft.price}
                required
                placeholder="350.000"
                onChange={(event) => {
                  const price = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, price } : prev));
                }}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Durasi" htmlFor="pkg-duration" hint="Contoh: 2 Hours, Up to 8 Hours.">
              <TextInput
                id="pkg-duration"
                maxLength={80}
                value={draft.duration}
                onChange={(event) => {
                  const duration = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, duration } : prev));
                }}
              />
            </Field>
            <Field label="Maks. orang" htmlFor="pkg-max" hint="Kosongkan bila tidak dibatasi.">
              <TextInput
                id="pkg-max"
                inputMode="numeric"
                value={draft.maxPersons}
                onChange={(event) => {
                  const maxPersons = event.target.value.replace(/[^0-9]/g, "");
                  setDraft((prev) => (prev ? { ...prev, maxPersons } : prev));
                }}
              />
            </Field>
            <Field label="Badge" htmlFor="pkg-badge" hint="Contoh: Best Seller. Kosong = tanpa badge.">
              <TextInput
                id="pkg-badge"
                maxLength={40}
                value={draft.badge}
                onChange={(event) => {
                  const badge = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, badge } : prev));
                }}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Kru"
              htmlFor="pkg-crew"
              hint="Satu baris per kru. Koma juga diterima."
            >
              <TextArea
                id="pkg-crew"
                rows={3}
                value={draft.crew}
                placeholder={"1 Main Photographer\n1 Videographer"}
                onChange={(event) => {
                  const crew = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, crew } : prev));
                }}
              />
            </Field>
            <Field
              label="Termasuk / deliverables"
              htmlFor="pkg-includes"
              hint="Satu baris per poin. Urutan ini yang tampil di halaman publik."
            >
              <TextArea
                id="pkg-includes"
                rows={3}
                value={draft.includes}
                placeholder={"40 Edited Photos\n1 Cinematic Highlight Video"}
                onChange={(event) => {
                  const includes = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, includes } : prev));
                }}
              />
            </Field>
          </div>

          <Field label="Catatan" htmlFor="pkg-notes" hint="Tampil sebagai keterangan kecil di bawah paket.">
            <TextArea
              id="pkg-notes"
              rows={2}
              maxLength={600}
              value={draft.notes}
              onChange={(event) => {
                const notes = event.target.value;
                setDraft((prev) => (prev ? { ...prev, notes } : prev));
              }}
            />
          </Field>

          <div className="flex items-center gap-2">
            <PrimaryButton type="submit" disabled={pending}>
              {pendingKey === busyKey ? "Menyimpan…" : "Simpan paket"}
            </PrimaryButton>
            <GhostButton onClick={() => setDraft(null)}>
              <X size={13} /> Batal
            </GhostButton>
            <span className="text-[10px] text-ash">
              Perubahan langsung tampil di /pricelist setelah disimpan.
            </span>
          </div>
        </form>
      ) : null}

      {visibleGroups.length === 0 ? (
        <p className="rounded-[36px] border border-dashed border-mist px-6 py-10 text-center text-sm text-fog">
          {packages.length === 0
            ? "Belum ada paket di pricelist."
            : "Kategori ini belum punya paket."}
        </p>
      ) : (
        visibleGroups.map(({ category, rows }) => (
          <section key={category.id} className="space-y-2">
            <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-fog">
              {category.name}
              <span className="ml-1.5 font-normal normal-case text-ash">
                ({rows.length} paket{category.is_active ? "" : " · kategori diarsipkan"})
              </span>
            </h3>
            <div className="grid gap-2 lg:grid-cols-2">
              {rows.map((row, index) => {
                const leads = leadCounts[row.id] ?? 0;
                const busy = pendingKey === row.id;
                return (
                  <article
                    key={row.id}
                    className="flex flex-col gap-2 rounded-[36px] border border-cloud bg-snow p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <RowIdentity
                        name={row.name}
                        meta={`${categoryName.get(row.category_id) ?? "—"} · #${row.slug}`}
                        badge={row.badge}
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          label="Naikkan urutan"
                          disabled={pending || index === 0}
                          onClick={() => run(row.id, () => reorderPackage(row.id, "up"))}
                        >
                          <ArrowUp size={13} />
                        </IconButton>
                        <IconButton
                          label="Turunkan urutan"
                          disabled={pending || index === rows.length - 1}
                          onClick={() => run(row.id, () => reorderPackage(row.id, "down"))}
                        >
                          <ArrowDown size={13} />
                        </IconButton>
                        <IconButton label="Ubah paket" disabled={pending} onClick={() => startEdit(row)}>
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label={
                            leads > 0
                              ? `Dipakai ${leads} lead — arsipkan, jangan hapus`
                              : "Hapus paket"
                          }
                          tone="danger"
                          disabled={pending || leads > 0}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Hapus paket "${row.name}"? Tindakan ini permanen.`,
                              )
                            ) {
                              return;
                            }
                            run(row.id, () => deletePackage(row.id));
                          }}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-iron">
                      <span className="text-sm font-semibold text-graphite">
                        {formatRupiahInput(row.price_idr)
                          ? `Rp ${formatRupiahInput(row.price_idr)}`
                          : "Rp 0"}
                      </span>
                      {row.duration ? <span>{row.duration}</span> : null}
                      {row.max_persons ? <span>maks {row.max_persons} orang</span> : null}
                      <ActiveToggle
                        isActive={row.is_active}
                        disabled={pending}
                        onToggle={() =>
                          run(row.id, () => setPackageActive(row.id, !row.is_active))
                        }
                      />
                      {leads > 0 ? (
                        <span className="text-ash">{leads} lead memakai paket ini</span>
                      ) : null}
                      {busy ? <span className="text-ash">menyimpan…</span> : null}
                    </div>

                    {row.crew.length > 0 ? (
                      <p className="text-[11px] leading-snug text-fog">
                        <span className="font-medium text-iron">Kru:</span>{" "}
                        {row.crew.join(" · ")}
                      </p>
                    ) : null}
                    {row.includes.length > 0 ? (
                      <ul className="grid gap-0.5 text-[11px] leading-snug text-fog">
                        {row.includes.map((entry) => (
                          <li key={entry} className="truncate">
                            — {entry}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {row.notes ? (
                      <p className="text-[11px] italic leading-snug text-ash">{row.notes}</p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
