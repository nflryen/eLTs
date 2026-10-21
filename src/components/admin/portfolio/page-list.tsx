"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, FileText, Plus, Rocket, Tag, Trash2 } from "lucide-react";
import {
  deletePortfolioPage,
  publishPortfolioPage,
  savePortfolioPage,
  unpublishPortfolioPage,
  type PortfolioPageRow,
} from "@/app/actions/portfolio";
import {
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_CATEGORY_LABELS,
  isPortfolioCategory,
  normalisePortfolioTags,
} from "@/lib/portfolio/category";

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function PortfolioPageList({ pages }: { pages: PortfolioPageRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: { id?: string } }>, after?: (id?: string) => void) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Terjadi kesalahan.");
        return;
      }
      after?.(res.data?.id);
      router.refresh();
    });
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    run(
      () =>
        savePortfolioPage({
          slug: slug || slugify(title),
          title: title.trim(),
          category: category === "" ? "" : (category as (typeof PORTFOLIO_CATEGORIES)[number]),
          tags: normalisePortfolioTags(tags.split(",")),
        }) as Promise<{ ok: boolean; error?: string; data?: { id?: string } }>,
      (id) => {
        setCreating(false);
        setTitle("");
        setSlug("");
        setSlugTouched(false);
        setCategory("");
        setTags("");
        if (id) router.push(`/admin/portfolio/${id}`);
      },
    );
  };

  return (
    <>
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {creating ? (
        <form onSubmit={create} className="space-y-3 rounded-xl border border-[#ececee] bg-white p-4">
          <div>
            <label htmlFor="p-title" className="mb-1 block text-xs font-medium text-[#3f3f46]">
              Judul
            </label>
            <input
              id="p-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              required
              className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
            />
          </div>
          <div>
            <label htmlFor="p-slug" className="mb-1 block text-xs font-medium text-[#3f3f46]">
              Slug
            </label>
            <input
              id="p-slug"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              required
              className="w-full rounded-lg border border-[#ececee] px-3 py-2 font-mono text-sm outline-none focus:border-[#18181b]"
            />
            <p className="mt-1 text-[11px] text-[#a1a1aa]">/portfolio/{slug || "…"}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="p-category" className="mb-1 block text-xs font-medium text-[#3f3f46]">
                Kategori
              </label>
              {/*
               * Options come from PORTFOLIO_CATEGORIES, the same list the zod
               * enum and the public filter read. A hardcoded <option> list here
               * is how the CMS and the filter drift apart.
               */}
              <select
                id="p-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-[#ececee] bg-white px-3 py-2 text-sm outline-none focus:border-[#18181b]"
              >
                <option value="">Tanpa kategori</option>
                {PORTFOLIO_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {PORTFOLIO_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="p-tags" className="mb-1 block text-xs font-medium text-[#3f3f46]">
                Tag
              </label>
              <input
                id="p-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="outdoor, intimate, golden hour"
                className="w-full rounded-lg border border-[#ececee] px-3 py-2 text-sm outline-none focus:border-[#18181b]"
              />
              <p className="mt-1 text-[11px] text-[#a1a1aa]">Pisahkan dengan koma.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[#18181b] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              {pending ? "Membuat…" : "Buat Halaman"}
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-[#71717a] hover:bg-[#f4f4f5]"
            >
              Batal
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[#18181b] px-3 py-2 text-xs font-medium text-white"
        >
          <Plus size={14} /> Halaman Baru
        </button>
      )}

      {pages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e4e4e7] p-10 text-center">
          <FileText size={20} className="mx-auto text-[#d4d4d8]" />
          <p className="mt-2 text-sm text-[#71717a]">Belum ada halaman portofolio.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#ececee] bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#ececee] bg-[#fafafa] text-[11px] uppercase tracking-wide text-[#71717a]">
              <tr>
                <th className="px-4 py-3 font-medium">Halaman</th>
                <th className="px-4 py-3 font-medium">Kategori</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              {pages.map((page) => (
                <tr key={page.id} className="hover:bg-[#fafafa]">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/portfolio/${page.id}`}
                      className="font-medium text-[#18181b] hover:underline"
                    >
                      {page.title}
                    </Link>
                    <p className="font-mono text-[11px] text-[#a1a1aa]">/portfolio/{page.slug}</p>
                  </td>
                  <td className="px-4 py-3">
                    {/*
                     * The stored value is `text` with a CHECK constraint, so it
                     * is narrowed with the shared type guard rather than cast:
                     * a row written before 0028 (or by a future vocabulary) must
                     * not crash the label lookup.
                     */}
                    {isPortfolioCategory(page.category) ? (
                      <span className="rounded-full border border-[#ececee] bg-[#f4f4f5] px-2 py-0.5 text-[10px] font-medium text-[#3f3f46]">
                        {PORTFOLIO_CATEGORY_LABELS[page.category]}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#a1a1aa]">—</span>
                    )}
                    {page.tags.length > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-[#a1a1aa]">
                        <Tag size={10} aria-hidden />
                        <span className="truncate">{page.tags.join(", ")}</span>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        page.status === "published"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {page.status === "published" ? "Terbit" : "Draf"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {page.status === "published" && (
                        <a
                          href={`/portfolio/${page.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          title="Lihat di situs publik"
                          className="rounded p-1.5 text-[#71717a] hover:bg-[#f4f4f5]"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        title={page.status === "published" ? "Tarik dari publik" : "Terbitkan"}
                        onClick={() =>
                          run(() =>
                            page.status === "published"
                              ? unpublishPortfolioPage(page.id)
                              : (publishPortfolioPage(page.id) as Promise<{ ok: boolean; error?: string }>),
                          )
                        }
                        className="rounded p-1.5 text-[#71717a] hover:bg-[#f4f4f5] disabled:opacity-40"
                      >
                        <Rocket size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        title="Hapus"
                        onClick={() => run(() => deletePortfolioPage(page.id))}
                        className="rounded p-1.5 text-[#a1a1aa] hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
