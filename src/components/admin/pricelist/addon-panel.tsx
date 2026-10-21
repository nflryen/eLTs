"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  deleteAddon,
  reorderAddon,
  saveAddon,
  setAddonActive,
  type PricelistAddonRow,
} from "@/app/actions/admin-pricelist";
import { formatRupiahInput, slugify } from "@/lib/pricelist-form";
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
  price: string;
  unit: string;
  description: string;
};

/**
 * Add-on tab.
 *
 * `unit` is the multiplier label the configurator reads ("per hour / per crew").
 * Leaving it empty means the add-on is priced once, not per unit — that is a
 * real distinction on the public page, so the hint says so explicitly.
 */
export function AddonPanel({ addons }: { addons: PricelistAddonRow[] }) {
  const { run, pending, pendingKey, error } = useActionRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  const startCreate = () => {
    setSlugTouched(false);
    setDraft({ slug: "", name: "", price: "", unit: "", description: "" });
  };

  const startEdit = (row: PricelistAddonRow) => {
    setSlugTouched(true);
    setDraft({
      id: row.id,
      slug: row.slug,
      name: row.name,
      price: formatRupiahInput(row.price_idr),
      unit: row.unit ?? "",
      description: row.description ?? "",
    });
  };

  const submit = () => {
    if (!draft) return;
    run(draft.id ?? "new-addon", () =>
      saveAddon({
        id: draft.id,
        slug: draft.slug.trim(),
        name: draft.name.trim(),
        /* RAW field value: the action's schema strips separators and validates. */
        priceIdr: draft.price,
        unit: draft.unit.trim() || null,
        description: draft.description.trim() || null,
      }),
      () => setDraft(null),
    );
  };

  const busyKey = draft ? (draft.id ?? "new-addon") : null;

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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nama add-on" htmlFor="addon-name">
              <TextInput
                id="addon-name"
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
            <Field label="Slug" htmlFor="addon-slug" hint="Dipakai di URL konfigurator (?addons=slug).">
              <TextInput
                id="addon-slug"
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
            <Field label="Harga (Rp)" htmlFor="addon-price" hint="Angka saja; titik pemisah diabaikan.">
              <TextInput
                id="addon-price"
                inputMode="numeric"
                value={draft.price}
                required
                placeholder="200.000"
                onChange={(event) => {
                  const price = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, price } : prev));
                }}
              />
            </Field>
            <Field
              label="Satuan"
              htmlFor="addon-unit"
              hint="Kosong = harga sekali bayar. Isi bila dihitung per jam/orang."
            >
              <TextInput
                id="addon-unit"
                maxLength={60}
                value={draft.unit}
                placeholder="per hour / per crew"
                onChange={(event) => {
                  const unit = event.target.value;
                  setDraft((prev) => (prev ? { ...prev, unit } : prev));
                }}
              />
            </Field>
          </div>

          <Field label="Deskripsi" htmlFor="addon-desc" hint="Satu baris; tampil di bawah nama add-on.">
            <TextArea
              id="addon-desc"
              rows={2}
              maxLength={300}
              value={draft.description}
              onChange={(event) => {
                const description = event.target.value;
                setDraft((prev) => (prev ? { ...prev, description } : prev));
              }}
            />
          </Field>

          <div className="flex items-center gap-2">
            <PrimaryButton type="submit" disabled={pending}>
              {pendingKey === busyKey ? "Menyimpan…" : "Simpan add-on"}
            </PrimaryButton>
            <GhostButton onClick={() => setDraft(null)}>
              <X size={13} /> Batal
            </GhostButton>
          </div>
        </form>
      ) : (
        <PrimaryButton onClick={startCreate}>
          <Plus size={14} /> Add-on baru
        </PrimaryButton>
      )}

      {addons.length === 0 ? (
        <p className="rounded-[36px] border border-dashed border-mist px-6 py-10 text-center text-sm text-fog">
          Belum ada add-on.
        </p>
      ) : (
        <div className="overflow-hidden rounded-[36px] border border-cloud bg-snow">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-cloud bg-[#fafafa] text-[11px] uppercase tracking-wide text-fog">
              <tr>
                <th className="w-14 px-3 py-2.5 font-medium">Urut</th>
                <th className="px-3 py-2.5 font-medium">Add-on</th>
                <th className="px-3 py-2.5 font-medium">Harga</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper">
              {addons.map((row, index) => (
                <tr key={row.id} className="align-top hover:bg-[#fafafa]">
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col">
                      <IconButton
                        label="Naikkan urutan"
                        disabled={pending || index === 0}
                        onClick={() => run(row.id, () => reorderAddon(row.id, "up"))}
                      >
                        <ArrowUp size={13} />
                      </IconButton>
                      <IconButton
                        label="Turunkan urutan"
                        disabled={pending || index === addons.length - 1}
                        onClick={() => run(row.id, () => reorderAddon(row.id, "down"))}
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
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-iron">
                    Rp {formatRupiahInput(row.price_idr) || "0"}
                    {row.unit ? (
                      <span className="ml-1 text-ash">/ {row.unit}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <ActiveToggle
                      isActive={row.is_active}
                      disabled={pending}
                      onToggle={() => run(row.id, () => setAddonActive(row.id, !row.is_active))}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <IconButton label="Ubah add-on" disabled={pending} onClick={() => startEdit(row)}>
                        <Pencil size={13} />
                      </IconButton>
                      <IconButton
                        label="Hapus add-on"
                        tone="danger"
                        disabled={pending}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Hapus add-on "${row.name}"? Lead lama tetap menyimpan nama dan harga yang sudah dikutip.`,
                            )
                          ) {
                            return;
                          }
                          run(row.id, () => deleteAddon(row.id));
                        }}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
