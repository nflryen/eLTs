"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteCategory,
  reorderCategory,
  saveCategory,
  setCategoryActive,
  type PricelistCategoryRow,
} from "@/app/actions/admin-pricelist";
import { slugify } from "@/lib/pricelist-form";
import {
  ActiveToggle,
  ErrorStrip,
  Field,
  GhostButton,
  IconButton,
  PrimaryButton,
  RowIdentity,
  TextArea,
  TextInput,
} from "@/components/admin/pricelist/ui";
import { useActionRunner } from "@/components/admin/pricelist/use-action-runner";

type Draft = {
  id?: string;
  slug: string;
  name: string;
  description: string;
};

const EMPTY_DRAFT: Draft = { slug: "", name: "", description: "" };

/**
 * Category tab: the tabs the public configurator renders, in the order it
 * renders them.
 *
 * `packageCount` is passed from the page rather than fetched here so the delete
 * button can explain itself BEFORE the operator clicks. The server action still
 * refuses on its own — the count is a courtesy, not the guard.
 */
export function CategoryPanel({
  categories,
  packageCounts,
}: {
  categories: PricelistCategoryRow[];
  packageCounts: Record<string, number>;
}) {
  const { run, pending, pendingKey, error } = useActionRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const startCreate = () => {
    setSlugTouched(false);
    setDraft({ ...EMPTY_DRAFT });
  };

  const startEdit = (row: PricelistCategoryRow) => {
    setSlugTouched(true);
    setDraft({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description ?? "",
    });
  };

  const submit = () => {
    if (!draft) return;
    run(draft.id ?? "new-category", () =>
      saveCategory({
        id: draft.id,
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
      }),
      () => setDraft(null),
    );
  };

  return (
    <div className="space-y-3">
      <ErrorStrip message={error} />

      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="space-y-3 rounded-[36px] border border-cloud bg-snow p-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama kategori" htmlFor="cat-name">
              <TextInput
                id="cat-name"
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
              htmlFor="cat-slug"
              hint="Huruf kecil, angka, tanda hubung. Dipakai di URL dan tidak boleh sama."
            >
              <TextInput
                id="cat-slug"
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
          </div>

          <Field label="Deskripsi" htmlFor="cat-desc" hint="Satu kalimat; tampil di bawah judul tab.">
            <TextArea
              id="cat-desc"
              rows={2}
              maxLength={600}
              value={draft.description}
              onChange={(event) => {
                const description = event.target.value;
                setDraft((prev) => (prev ? { ...prev, description } : prev));
              }}
            />
          </Field>

          <div className="flex gap-2">
            <PrimaryButton type="submit" disabled={pending}>
              {pendingKey === (draft.id ?? "new-category") ? "Menyimpan…" : "Simpan kategori"}
            </PrimaryButton>
            <GhostButton onClick={() => setDraft(null)}>
              <X size={13} /> Batal
            </GhostButton>
          </div>
        </form>
      ) : (
        <PrimaryButton onClick={startCreate}>
          <Plus size={14} /> Kategori baru
        </PrimaryButton>
      )}

      {categories.length === 0 ? (
        <p className="rounded-[36px] border border-dashed border-mist px-6 py-10 text-center text-sm text-fog">
          Belum ada kategori. Buat satu dulu sebelum menambah paket.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[36px] border border-cloud bg-snow">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-cloud bg-[#fafafa] text-[11px] uppercase tracking-wide text-fog">
              <tr>
                <th className="w-14 px-3 py-2.5 font-medium">Urut</th>
                <th className="px-3 py-2.5 font-medium">Kategori</th>
                <th className="px-3 py-2.5 font-medium">Paket</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper">
              {categories.map((row, index) => {
                const count = packageCounts[row.id] ?? 0;
                const busy = pendingKey === row.id;
                return (
                  <tr key={row.id} className="align-top hover:bg-[#fafafa]">
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col">
                        <IconButton
                          label="Naikkan urutan"
                          disabled={pending || index === 0}
                          onClick={() => run(row.id, () => reorderCategory(row.id, "up"))}
                        >
                          <ArrowUp size={13} />
                        </IconButton>
                        <IconButton
                          label="Turunkan urutan"
                          disabled={pending || index === categories.length - 1}
                          onClick={() => run(row.id, () => reorderCategory(row.id, "down"))}
                        >
                          <ArrowDown size={13} />
                        </IconButton>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <RowIdentity name={row.name} meta={`#${row.slug}`} />
                      {row.description ? (
                        <p className="mt-0.5 max-w-md text-[11px] leading-snug text-fog">
                          {row.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-iron">
                      {count > 0 ? (
                        `${count} paket`
                      ) : (
                        <span className="text-ash">kosong</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <ActiveToggle
                        isActive={row.is_active}
                        disabled={pending}
                        onToggle={() => run(row.id, () => setCategoryActive(row.id, !row.is_active))}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <IconButton label="Ubah kategori" disabled={pending} onClick={() => startEdit(row)}>
                          <Pencil size={13} />
                        </IconButton>
                        <IconButton
                          label={
                            count > 0
                              ? `Tidak bisa dihapus — masih berisi ${count} paket`
                              : "Hapus kategori"
                          }
                          tone="danger"
                          disabled={pending || count > 0}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Hapus kategori "${row.name}"? Tindakan ini permanen.`,
                              )
                            ) {
                              return;
                            }
                            run(row.id, () => deleteCategory(row.id));
                          }}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                      {busy ? <p className="mt-1 text-right text-[10px] text-ash">…</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
