"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Grid3x3,
  Image as ImageIcon,
  LayoutTemplate,
  Save,
  Trash2,
  Type,
} from "lucide-react";
import {
  addBlock,
  LAYOUT_TEMPLATES,
  layoutToGridStyle,
  moveBlock,
  normaliseLayout,
  removeBlock,
  resizeBlock,
  updateBlock,
  type LayoutBlock,
  type LayoutDoc,
} from "@/lib/portfolio/layout";
import { savePortfolioPage, savePortfolioSection } from "@/app/actions/portfolio";
import {
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_CATEGORY_LABELS,
  normalisePortfolioTags,
  type PortfolioCategory,
} from "@/lib/portfolio/category";

/**
 * Drag-and-drop portfolio layout editor.
 *
 * ZERO EXTERNAL DEPENDENCIES — pointer events only.
 *
 * WHY HAND-ROLLED
 * ---------------
 * A drag library would add ~35 kB to a page only staff ever load, and the
 * interaction here is unusually simple: blocks move on a fixed grid of cells.
 * The entire gesture is "record where the pointer started, convert the pixel
 * delta into cells, clamp, commit". That is less code than the integration a
 * library would need, and it cannot break on a library upgrade.
 *
 * WHY CELLS AND NOT PIXELS
 * ------------------------
 * The canvas is ~1000px wide; a client's phone is ~390px. Storing pixel
 * offsets means the layout the team arranges here reflows badly on the device
 * that matters, and every page gets fixed twice. `layoutToGridStyle` is shared
 * with the public renderer, so what is arranged here is what ships.
 */
type Props = {
  pageId: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  category: PortfolioCategory | null;
  tags: string[];
  sections: Array<{ id: string; layout: unknown; sort_order: number }>;
};

/*
 * Canvas geometry — ONE source for the pixels both the CSS and the pointer math
 * rely on.
 *
 * These were previously three independent numbers (a Tailwind `gap-3`, a
 * Tailwind `p-3`, and a bare `70`), which drifted: the real row pitch is
 * row height PLUS the gap, so dividing by `70` moved a block two rows for a
 * three-row drag. Duplicating them in the CSS while the math held the originals
 * is the whole bug, so the CSS reads these constants too.
 */
const CELL_GAP = 12;
const ROW_PX = 70;
/** Canvas inner padding, taken off `clientWidth` before any cell width is derived. */
const CANVAS_PAD = 12;


type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; originX: number; originY: number }
  | { mode: "resize"; id: string; startX: number; startY: number; originW: number; originH: number }
  | null;

export function LayoutEditor({ pageId, slug, title, status, category, tags, sections }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);

  /*
   * `sectionId` is STATE, not a constant read from `sections[0]`.
   *
   * A page holds several bands (hero, canvas, gallery), so pinning the editor to
   * the first one made every other section unreachable. It must also be
   * WRITABLE: a page created from the page list has no sections at all, and the
   * first save INSERTS one — without adopting the returned id, the next save
   * would insert a second section instead of updating the first.
   */
  const [sectionId, setSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const [layout, setLayout] = useState<LayoutDoc>(() => normaliseLayout(sections[0]?.layout));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Page METADATA is a separate save from the layout, deliberately.
   *
   * The layout button persists the canvas document; folding category and tags
   * into it would mean an operator who only wanted to recategorise a page also
   * rewrites its geometry, and a stale canvas would then be committed by a
   * metadata edit. Two concerns, two writes, two dirty flags.
   */
  const [pageCategory, setPageCategory] = useState<PortfolioCategory | "">(category ?? "");
  const [pageTags, setPageTags] = useState(tags.join(", "));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const saveSettings = () => {
    setSettingsError(null);
    setSettingsSaved(false);
    startTransition(async () => {
      const res = await savePortfolioPage({
        id: pageId,
        slug,
        title,
        category: pageCategory,
        tags: normalisePortfolioTags(pageTags.split(",")),
      });

      if (!res.ok) {
        setSettingsError(res.error);
        return;
      }

      /*
       * Re-seed from the RETURNED row, not from local state: the server
       * normalises tags, so the field must show what was actually stored or the
       * next save would submit a value the operator never saw.
       */
      setPageCategory(res.data?.category ?? "");
      setPageTags((res.data?.tags ?? []).join(", "));
      setSettingsDirty(false);
      setSettingsSaved(true);
      router.refresh();
    });
  };

  const selected = useMemo(
    () => layout.blocks.find((b) => b.id === selectedId) ?? null,
    [layout.blocks, selectedId],
  );

  /**
   * Pixel width of one grid cell, measured live so a drag stays exact.
   *
   * `clientWidth` is the PADDING-BOX width, so the canvas padding has to come
   * off before the gaps are subtracted. Dividing the border-box width (what
   * `getBoundingClientRect()` returns) overestimated every cell by ~2px, which
   * accumulated to a full cell of error by the last column.
   */
  const cellWidth = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return 1;
    const usable = el.clientWidth - CANVAS_PAD * 2 - CELL_GAP * (layout.grid.cols - 1);
    return Math.max(1, usable / layout.grid.cols);
  }, [layout.grid.cols]);

  /*
   * ROW_PX is the HEIGHT of a row box; the gap sits BETWEEN boxes, so one row of
   * pointer travel is ROW_PX + CELL_GAP. The CSS below reads ROW_PX and the
   * pointer math reads the pitch, both derived from the same constant — the
   * original bug was a bare `70` in the math against a `gap-3` in the class,
   * so a three-row drag reported dy=4.
   */
  const cellHeight = ROW_PX;
  const rowPitch = ROW_PX + CELL_GAP;

  const mutate = (next: LayoutDoc) => {
    setLayout(next);
    setDirty(true);
  };

  /* ── Pointer handling ──────────────────────────────────────────────────── */
  const beginDrag = (
    e: React.PointerEvent,
    block: LayoutBlock,
    mode: "move" | "resize",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(block.id);

    /*
     * Pointer capture keeps the gesture alive even when the cursor leaves the
     * block — without it a fast drag drops the block the moment the pointer
     * crosses the canvas edge, which feels broken.
     */
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    dragRef.current =
      mode === "move"
        ? { mode, id: block.id, startX: e.clientX, startY: e.clientY, originX: block.x, originY: block.y }
        : { mode, id: block.id, startX: e.clientX, startY: e.clientY, originW: block.w, originH: block.h };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = Math.round((e.clientX - drag.startX) / cellWidth());
      const dy = Math.round((e.clientY - drag.startY) / rowPitch);

      setLayout((prev) => {
        const target = prev.blocks.find((b) => b.id === drag.id);
        if (!target) return prev;

        const next =
          drag.mode === "move"
            ? moveBlock({ ...target, x: drag.originX, y: drag.originY }, dx, dy, prev.grid)
            : resizeBlock({ ...target, w: drag.originW, h: drag.originH }, dx, dy, prev.grid);

        return { ...prev, blocks: prev.blocks.map((b) => (b.id === drag.id ? next : b)) };
      });
      setDirty(true);
    };

    const onUp = () => {
      if (dragRef.current) dragRef.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [cellWidth, rowPitch]);

  /** Arrow keys nudge the selected block — the keyboard path for the drag. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;

      const step: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = step[e.key];
      if (!delta) {
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          mutate(removeBlock(layout, selectedId));
          setSelectedId(null);
        }
        return;
      }
      e.preventDefault();
      setLayout((prev) => ({
        ...prev,
        blocks: prev.blocks.map((b) =>
          b.id === selectedId ? moveBlock(b, delta[0], delta[1], prev.grid) : b,
        ),
      }));
      setDirty(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, layout]);

  /* ── Persistence ───────────────────────────────────────────────────────── */
  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await savePortfolioSection({
        id: sectionId ?? undefined,
        pageId,
        kind: "canvas",
        layout,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      /*
       * ADOPT the id the insert returned. This is the point of keeping
       * `sectionId` in state: a page created from the page list has no section
       * row yet, so the first save INSERTS one — and without adopting that id
       * the next save would insert a duplicate instead of updating it.
       */
      if (res.data) setSectionId(res.data.id);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("id-ID"));
      router.refresh();
    });
  };

  /**
   * Switches the edited band. The outgoing layout is intentionally NOT saved
   * automatically: silently persisting an abandoned edit is worse than losing
   * it, and the dirty flag warns before the switch.
   */
  const switchSection = (nextId: string) => {
    if (nextId === sectionId) return;
    const target = sections.find((s) => s.id === nextId);
    setSectionId(nextId);
    setLayout(normaliseLayout(target?.layout));
    setSelectedId(null);
    setDirty(false);
    setSavedAt(null);
  };

  const applyTemplate = (templateId: string) => {
    const tpl = LAYOUT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    mutate(tpl.build());
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      {/* ── Canvas ──────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => mutate(addBlock(layout, { type: "photo" }))}
            className="flex items-center gap-1.5 rounded-lg border border-[#ececee] px-2.5 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
          >
            <ImageIcon size={13} /> Foto
          </button>
          <button
            type="button"
            onClick={() => mutate(addBlock(layout, { type: "text", html: "<h3>Judul</h3><p>Teks.</p>" }))}
            className="flex items-center gap-1.5 rounded-lg border border-[#ececee] px-2.5 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
          >
            <Type size={13} /> Teks
          </button>

          <span className="mx-1 h-4 w-px bg-[#ececee]" />
          {/*
           * Section switcher. Only shown when there is more than one band:
           * a single-section page needs no control, and an empty page has
           * nothing to switch to (its first save creates the row).
           */}
          {sections.length > 1 ? (
            <>
              <span className="mx-1 h-4 w-px bg-[#ececee]" />
              <select
                value={sectionId ?? ""}
                onChange={(e) => switchSection(e.target.value)}
                aria-label="Pilih bagian"
                className="rounded-lg border border-[#ececee] px-2 py-1.5 text-xs"
              >
                {sections.map((section, index) => (
                  <option key={section.id} value={section.id}>
                    Bagian {index + 1}
                  </option>
                ))}
              </select>
            </>
          ) : null}


          <div className="flex items-center gap-1">
            <LayoutTemplate size={13} className="text-[#a1a1aa]" />
            <select
              onChange={(e) => e.target.value && applyTemplate(e.target.value)}
              defaultValue=""
              className="rounded-lg border border-[#ececee] px-2 py-1.5 text-xs"
            >
              <option value="">Template…</option>
              {LAYOUT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {savedAt && !dirty && (
              <span className="text-[11px] text-emerald-600">Tersimpan {savedAt}</span>
            )}
            {dirty && <span className="text-[11px] text-amber-600">Belum disimpan</span>}
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="flex items-center gap-1.5 rounded-lg bg-[#18181b] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              <Save size={13} /> {pending ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </div>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        <div
          ref={canvasRef}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelectedId(null);
          }}
          /*
           * `gap` and `padding` come from the SAME constants the pointer math
           * divides by. Writing them as `gap-3`/`p-3` here while the math held
           * its own numbers is exactly how the drag drifted: the two agreed
           * only until one of them changed.
           */
          className="relative grid rounded-xl border border-[#ececee] bg-[#fafafa]"
          style={{
            gap: `${CELL_GAP}px`,
            padding: `${CANVAS_PAD}px`,
            gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
            gridAutoRows: `${cellHeight}px`,
          }}
        >
          {/* Grid overlay makes the cell contract visible while dragging. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-3 opacity-[0.35]"
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${Math.max(layout.grid.rows, 8)}, ${cellHeight}px)`,
              gap: "0.75rem",
            }}
          >
            {Array.from({ length: layout.grid.cols * Math.max(layout.grid.rows, 8) }).map((_, i) => (
              <div key={i} className="rounded border border-dashed border-[#e4e4e7]" />
            ))}
          </div>

          {layout.blocks.map((block) => {
            const active = selectedId === block.id;
            return (
              <div
                key={block.id}
                style={layoutToGridStyle(block)}
                onPointerDown={(e) => beginDrag(e, block, "move")}
                className={`group relative z-10 cursor-grab touch-none overflow-hidden rounded-lg border-2 bg-white active:cursor-grabbing ${
                  active ? "border-[#18181b]" : "border-transparent hover:border-[#d4d4d8]"
                }`}
              >
                {block.type === "photo" ? (
                  <div className="flex h-full items-center justify-center bg-[#f4f4f5] text-[11px] text-[#a1a1aa]">
                    <Grid3x3 size={14} className="mr-1" />
                    Foto {block.w}×{block.h}
                  </div>
                ) : (
                  <div
                    className="prose prose-sm max-w-none overflow-hidden p-2 text-[11px] text-[#3f3f46]"
                    dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
                  />
                )}

                {/* Resize handle: bottom-right, same pointer protocol as move. */}
                <span
                  role="presentation"
                  onPointerDown={(e) => beginDrag(e, block, "resize")}
                  className="absolute bottom-0 right-0 z-20 h-3.5 w-3.5 cursor-nwse-resize touch-none rounded-tl bg-[#18181b] opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-[#a1a1aa]">
          Tarik blok untuk memindahkan, tarik sudut kanan bawah untuk mengubah ukuran. Gunakan
          tombol panah untuk geser 1 sel, Delete untuk menghapus.
        </p>
      </div>

      {/* ── Inspector ───────────────────────────────────────────────────── */}
      <aside className="space-y-3 rounded-xl border border-[#ececee] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#18181b]">Properti Blok</h2>

        {!selected ? (
          <p className="text-xs text-[#a1a1aa]">Pilih blok pada kanvas untuk mengedit.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-[#71717a]">
              {selected.type === "photo" ? "Foto" : "Teks"} · {selected.w}×{selected.h} sel
            </p>

            <div className="grid grid-cols-2 gap-2">
              {(["x", "y", "w", "h"] as const).map((key) => (
                <label key={key} className="text-[11px] text-[#71717a]">
                  {key.toUpperCase()}
                  <input
                    type="number"
                    value={selected[key]}
                    min={key === "w" || key === "h" ? 1 : 0}
                    onChange={(e) =>
                      mutate(updateBlock(layout, selected.id, { [key]: Number(e.target.value) }))
                    }
                    className="mt-0.5 w-full rounded border border-[#ececee] px-2 py-1 text-xs"
                  />
                </label>
              ))}
            </div>

            {selected.type === "photo" && (
              <label className="block text-[11px] text-[#71717a]">
                URL Foto Publik
                <input
                  type="url"
                  value={selected.publicUrl ?? ""}
                  placeholder="https://res.cloudinary.com/..."
                  onChange={(e) =>
                    mutate(updateBlock(layout, selected.id, { publicUrl: e.target.value }))
                  }
                  className="mt-0.5 w-full rounded border border-[#ececee] px-2 py-1 text-[11px]"
                />
                <span className="mt-0.5 block text-[10px] text-[#a1a1aa]">
                  Harus URL publik. Galeri klien bersifat privat dan tidak dapat dipakai di sini.
                </span>
              </label>
            )}

            {selected.type === "text" && (
              <label className="block text-[11px] text-[#71717a]">
                HTML
                <textarea
                  value={selected.html ?? ""}
                  onChange={(e) => mutate(updateBlock(layout, selected.id, { html: e.target.value }))}
                  rows={5}
                  className="mt-0.5 w-full rounded border border-[#ececee] px-2 py-1 font-mono text-[11px]"
                />
              </label>
            )}

            <button
              type="button"
              onClick={() => {
                mutate(removeBlock(layout, selected.id));
                setSelectedId(null);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} /> Hapus Blok
            </button>
          </div>
        )}

        {/* ── Page settings ─────────────────────────────────────────────── */}
        <div className="space-y-2 border-t border-[#f4f4f5] pt-3">
          <h2 className="text-sm font-semibold text-[#18181b]">Pengaturan Halaman</h2>

          <label htmlFor="page-category" className="block text-[11px] text-[#71717a]">
            Kategori
            <select
              id="page-category"
              value={pageCategory}
              onChange={(e) => {
                setPageCategory(e.target.value as PortfolioCategory | "");
                setSettingsDirty(true);
                setSettingsSaved(false);
              }}
              className="mt-0.5 w-full rounded border border-[#ececee] bg-white px-2 py-1 text-xs"
            >
              <option value="">Tanpa kategori</option>
              {PORTFOLIO_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {PORTFOLIO_CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="page-tags" className="block text-[11px] text-[#71717a]">
            Tag
            <input
              id="page-tags"
              value={pageTags}
              placeholder="outdoor, intimate, golden hour"
              onChange={(e) => {
                setPageTags(e.target.value);
                setSettingsDirty(true);
                setSettingsSaved(false);
              }}
              className="mt-0.5 w-full rounded border border-[#ececee] px-2 py-1 text-xs"
            />
            <span className="mt-0.5 block text-[10px] text-[#a1a1aa]">
              Pisahkan dengan koma. Kategori menentukan filter di halaman publik.
            </span>
          </label>

          {settingsError && (
            <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
              {settingsError}
            </p>
          )}

          <button
            type="button"
            onClick={saveSettings}
            disabled={pending || !settingsDirty}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#18181b] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            {settingsSaved && !settingsDirty ? <Check size={13} /> : <Save size={13} />}
            {pending ? "Menyimpan…" : settingsSaved && !settingsDirty ? "Tersimpan" : "Simpan Pengaturan"}
          </button>
        </div>

        <div className="border-t border-[#f4f4f5] pt-3 text-[11px] text-[#a1a1aa]">
          <p>
            Status:{" "}
            <span className="font-medium text-[#3f3f46]">
              {status === "published" ? "Terbit" : "Draf"}
            </span>
          </p>
          <p className="mt-1 font-mono">/portfolio/{slug}</p>
        </div>
      </aside>
    </div>
  );
}
