"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Crop,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Monitor,
  Plus,
  Save,
  Smartphone,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import {
  addBlock,
  appendTemplateToLayout,
  expandLayoutRows,
  EMPTY_LAYOUT,
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
import { uploadImageToCloudinary } from "@/lib/upload-client";
import { CanvasRenderer } from "@/components/public/portfolio/canvas-renderer";

type Props = {
  pageId: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  category: PortfolioCategory | null;
  tags: string[];
  coverUrl?: string | null;
  sections: Array<{ id: string; layout: unknown; sort_order: number }>;
};

const CELL_GAP = 12;
const ROW_PX = 70;
const CANVAS_PAD = 12;

type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; originX: number; originY: number }
  | { mode: "resize"; id: string; startX: number; startY: number; originW: number; originH: number }
  | null;

export function LayoutEditor({
  pageId,
  slug,
  title,
  status,
  category,
  tags,
  coverUrl,
  sections,
}: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);

  const [sectionId, setSectionId] = useState<string | null>(sections[0]?.id ?? null);
  const [layout, setLayout] = useState<LayoutDoc>(() => normaliseLayout(sections[0]?.layout));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Dual preview mode: "desktop" interactive canvas vs "mobile" 390px simulation
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");

  // Template combination state
  const [pendingTemplate, setPendingTemplate] = useState<{ id: string; label: string } | null>(null);

  // Crop & framing modal state
  const [croppingBlock, setCroppingBlock] = useState<LayoutBlock | null>(null);
  const [cropX, setCropX] = useState<number>(50);
  const [cropY, setCropY] = useState<number>(50);
  const [zoom, setZoom] = useState<number>(1);
  const [fitMode, setFitMode] = useState<"cover" | "contain">("cover");

  // Page metadata settings
  const [pageCategory, setPageCategory] = useState<PortfolioCategory | "">(category ?? "");
  const [pageTags, setPageTags] = useState(tags.join(", "));
  const [pageCoverUrl, setPageCoverUrl] = useState<string>(coverUrl ?? "");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingBlockId, setUploadingBlockId] = useState<string | null>(null);
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
        coverUrl: pageCoverUrl.trim() || "",
      });

      if (!res.ok) {
        setSettingsError(res.error);
        return;
      }

      setPageCategory(res.data?.category ?? "");
      setPageTags((res.data?.tags ?? []).join(", "));
      if (res.data?.cover_url !== undefined) {
        setPageCoverUrl(res.data.cover_url ?? "");
      }
      setSettingsDirty(false);
      setSettingsSaved(true);
      router.refresh();
    });
  };

  const selected = useMemo(
    () => layout.blocks.find((b) => b.id === selectedId) ?? null,
    [layout.blocks, selectedId],
  );

  const cellWidth = useCallback((): number => {
    const el = canvasRef.current;
    if (!el) return 100;
    const usable = el.clientWidth - CANVAS_PAD * 2 - CELL_GAP * (layout.grid.cols - 1);
    return Math.max(10, usable / layout.grid.cols);
  }, [layout.grid.cols]);

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

        // Dynamically expand rows if moving or resizing past the bottom
        const targetBottom =
          drag.mode === "move"
            ? drag.originY + dy + target.h
            : target.y + drag.originH + dy;
        const expandedRows = Math.max(prev.grid.rows, targetBottom + 2, 8);
        const dynamicGrid = { cols: prev.grid.cols, rows: expandedRows };

        const next =
          drag.mode === "move"
            ? moveBlock({ ...target, x: drag.originX, y: drag.originY }, dx, dy, dynamicGrid)
            : resizeBlock({ ...target, w: drag.originW, h: drag.originH }, dx, dy, dynamicGrid);

        return {
          ...prev,
          grid: dynamicGrid,
          blocks: prev.blocks.map((b) => (b.id === drag.id ? next : b)),
        };
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
      setLayout((prev) => {
        const currentBlock = prev.blocks.find((b) => b.id === selectedId);
        if (!currentBlock) return prev;
        const newBottom = currentBlock.y + delta[1] + currentBlock.h;
        const expandedRows = Math.max(prev.grid.rows, newBottom + 2, 8);
        const dynamicGrid = { cols: prev.grid.cols, rows: expandedRows };

        return {
          ...prev,
          grid: dynamicGrid,
          blocks: prev.blocks.map((b) =>
            b.id === selectedId ? moveBlock(b, delta[0], delta[1], dynamicGrid) : b,
          ),
        };
      });
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

      if (res.data) setSectionId(res.data.id);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("id-ID"));
      router.refresh();
    });
  };

  const switchSection = (nextId: string) => {
    if (nextId === sectionId) return;
    const target = sections.find((s) => s.id === nextId);
    setSectionId(nextId);
    setLayout(normaliseLayout(target?.layout));
    setSelectedId(null);
    setDirty(false);
    setSavedAt(null);
  };

  const addNewSection = () => {
    if (dirty && !window.confirm("Perubahan pada bagian ini belum disimpan. Tetap buat bagian baru?")) {
      return;
    }
    startTransition(async () => {
      const res = await savePortfolioSection({
        pageId,
        kind: "canvas",
        layout: EMPTY_LAYOUT,
        sortOrder: sections.length,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.data) {
        setSectionId(res.data.id);
        setLayout(EMPTY_LAYOUT);
        setSelectedId(null);
        setDirty(false);
        setSavedAt(null);
        router.refresh();
      }
    });
  };

  /* ── Template Handling (Multiple Sequential Combination) ─────────────────── */
  const handleTemplateSelect = (templateId: string) => {
    if (!templateId) return;
    const tpl = LAYOUT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;

    if (layout.blocks.length === 0) {
      mutate(tpl.build());
    } else {
      // Prompt whether to append sequentially or replace
      setPendingTemplate({ id: tpl.id, label: tpl.label });
    }
  };

  const applyTemplateChoice = (templateId: string, mode: "replace" | "append") => {
    const tpl = LAYOUT_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    const built = tpl.build();
    if (mode === "append") {
      mutate(appendTemplateToLayout(layout, built));
    } else {
      mutate(built);
    }
    setPendingTemplate(null);
  };

  /* ── Crop & Framing Editor ──────────────────────────────────────────────── */
  const openCropEditor = (b: LayoutBlock) => {
    setCroppingBlock(b);
    setCropX(b.cropX ?? 50);
    setCropY(b.cropY ?? 50);
    setZoom(b.zoom ?? 1);
    setFitMode(b.fit ?? "cover");
  };

  const applyCrop = () => {
    if (!croppingBlock) return;
    mutate(
      updateBlock(layout, croppingBlock.id, {
        cropX,
        cropY,
        zoom,
        fit: fitMode,
      }),
    );
    setCroppingBlock(null);
  };

  // Calculate effective vertical grid height
  const maxBlockBottom = layout.blocks.reduce((max, b) => Math.max(max, b.y + b.h), 0);
  const effectiveGridRows = Math.max(layout.grid.rows, maxBlockBottom + 2, 8);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_290px]">
      {/* ── Canvas Workspace ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Top Action Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Add Block Actions */}
          <button
            type="button"
            onClick={() => mutate(addBlock(layout, { type: "photo" }))}
            className="flex items-center gap-1.5 rounded-lg border border-[#ececee] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
          >
            <ImageIcon size={13} /> Foto
          </button>
          <button
            type="button"
            onClick={() => mutate(addBlock(layout, { type: "text", html: "<h3>Judul</h3><p>Teks deskripsi.</p>" }))}
            className="flex items-center gap-1.5 rounded-lg border border-[#ececee] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
          >
            <Type size={13} /> Teks
          </button>

          <span className="mx-0.5 h-4 w-px bg-[#ececee]" />

          {/* Section Switcher & Add Section */}
          <div className="flex items-center gap-1">
            <select
              value={sectionId ?? ""}
              onChange={(e) => switchSection(e.target.value)}
              aria-label="Pilih bagian"
              className="rounded-lg border border-[#ececee] bg-white px-2 py-1.5 text-xs font-medium text-[#3f3f46]"
            >
              {sections.map((section, index) => (
                <option key={section.id} value={section.id}>
                  Bagian {index + 1}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addNewSection}
              title="Tambah bagian baru pada halaman ini"
              className="flex items-center gap-1 rounded-lg border border-[#ececee] bg-white px-2 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
            >
              <Plus size={13} /> Bagian
            </button>
          </div>

          <span className="mx-0.5 h-4 w-px bg-[#ececee]" />

          {/* Multiple Template Combiner */}
          <div className="flex items-center gap-1">
            <LayoutTemplate size={13} className="text-[#a1a1aa]" />
            <select
              onChange={(e) => {
                if (e.target.value) {
                  handleTemplateSelect(e.target.value);
                  e.target.value = "";
                }
              }}
              defaultValue=""
              className="rounded-lg border border-[#ececee] bg-white px-2 py-1.5 text-xs text-[#3f3f46]"
            >
              <option value="">+ Template…</option>
              {LAYOUT_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <span className="mx-0.5 h-4 w-px bg-[#ececee]" />

          {/* Responsive Dual Preview Mode Toggle (Desktop vs Mobile Simulation) */}
          <div className="flex items-center rounded-lg border border-[#ececee] bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setPreviewMode("desktop")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                previewMode === "desktop"
                  ? "bg-[#18181b] text-white"
                  : "text-[#71717a] hover:text-[#18181b]"
              }`}
              title="Simulasi Tampilan Desktop"
            >
              <Monitor size={13} />
              <span>Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setPreviewMode("mobile")}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
                previewMode === "mobile"
                  ? "bg-[#18181b] text-white"
                  : "text-[#71717a] hover:text-[#18181b]"
              }`}
              title="Simulasi Tampilan Mobile (390px)"
            >
              <Smartphone size={13} />
              <span>Mobile</span>
            </button>
          </div>

          {/* Save Status & Button */}
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

        {/* ── Desktop Canvas vs. Mobile Simulation ── */}
        {previewMode === "mobile" ? (
          <div className="rounded-2xl border border-[#ececee] bg-[#fafafa] p-8 text-center">
            <div className="mb-3 text-[11px] text-[#71717a]">
              Simulasi tampilan mobile perangkat iPhone (390px) berdasarkan rasio aspek yang disusun.
            </div>
            {/* iPhone Frame Simulator */}
            <div className="mx-auto w-[390px] rounded-[48px] border-[8px] border-[#18181b] bg-white p-4 shadow-2xl">
              {/* Dynamic island notch */}
              <div className="mx-auto mb-4 h-4 w-28 rounded-full bg-[#18181b]" />
              <div className="max-h-[640px] overflow-y-auto no-scrollbar space-y-4 text-left">
                <CanvasRenderer layout={layout} />
              </div>
            </div>
          </div>
        ) : (
          /* Desktop Interactive Canvas */
          <div
            ref={canvasRef}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
            className="relative grid rounded-xl border border-[#ececee] bg-[#fafafa] transition-all"
            style={{
              gap: `${CELL_GAP}px`,
              padding: `${CANVAS_PAD}px`,
              gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
              gridAutoRows: `${ROW_PX}px`,
              minHeight: `${effectiveGridRows * (ROW_PX + CELL_GAP)}px`,
            }}
          >
            {/* Grid overlay makes the cell grid contract visible while dragging */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-3 opacity-[0.35]"
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${layout.grid.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${effectiveGridRows}, ${ROW_PX}px)`,
                gap: `${CELL_GAP}px`,
              }}
            >
              {Array.from({ length: layout.grid.cols * effectiveGridRows }).map((_, i) => (
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
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (block.type === "photo" && block.publicUrl) {
                      openCropEditor(block);
                    }
                  }}
                  className={`group relative z-10 cursor-grab touch-none overflow-hidden rounded-lg border-2 bg-white active:cursor-grabbing ${
                    active ? "border-[#18181b] shadow-md ring-2 ring-[#18181b]/20" : "border-transparent hover:border-[#d4d4d8]"
                  }`}
                >
                  {/* Photo Block: LIVE Image Thumbnail Preview */}
                  {block.type === "photo" ? (
                    block.publicUrl ? (
                      <div className="relative h-full w-full overflow-hidden bg-[#f4f4f5]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={block.publicUrl}
                          alt=""
                          draggable={false}
                          className="pointer-events-none h-full w-full select-none"
                          style={{
                            objectFit: block.fit === "contain" ? "contain" : "cover",
                            objectPosition: `${block.cropX ?? 50}% ${block.cropY ?? 50}%`,
                            transform: block.zoom && block.zoom > 1 ? `scale(${block.zoom})` : undefined,
                            transformOrigin: `${block.cropX ?? 50}% ${block.cropY ?? 50}%`,
                          }}
                        />
                        {/* Interactive hint on hover */}
                        <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-[#09090b]/75 px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                          <Crop size={9} />
                          <span>Klik 2x atur crop · {block.w}×{block.h}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center bg-[#f4f4f5] text-[11px] text-[#a1a1aa]">
                        <ImageIcon size={16} className="mb-1 text-[#a1a1aa]" />
                        <span>Foto {block.w}×{block.h}</span>
                      </div>
                    )
                  ) : (
                    <div
                      className="prose prose-sm max-w-none overflow-hidden p-2 text-[11px] text-[#3f3f46]"
                      dangerouslySetInnerHTML={{ __html: block.html ?? "" }}
                    />
                  )}

                  {/* Resize handle */}
                  <span
                    role="presentation"
                    onPointerDown={(e) => beginDrag(e, block, "resize")}
                    className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize touch-none rounded-tl bg-[#18181b] opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* Vertical Canvas Extension Button */}
        {previewMode === "desktop" && (
          <button
            type="button"
            onClick={() => mutate(expandLayoutRows(layout, 4))}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#d4d4d8] bg-white/70 py-3 text-xs font-medium text-[#71717a] transition-colors hover:border-[#18181b] hover:bg-white hover:text-[#18181b]"
          >
            <Plus size={14} /> Tambah 4 Baris ke Bawah (Perluas Kanvas Vertikal)
          </button>
        )}

        <p className="text-[11px] text-[#a1a1aa]">
          Tarik blok untuk memindahkan, tarik sudut kanan bawah untuk mengubah ukuran. Double-click blok foto untuk mengatur crop. Gunakan tombol panah untuk geser 1 sel, Delete untuk menghapus.
        </p>
      </div>

      {/* ── Sidebar Inspector & Settings ─────────────────────────────────── */}
      <aside className="space-y-4 rounded-xl border border-[#ececee] bg-white p-4">
        {/* Block Inspector */}
        <div>
          <h2 className="text-sm font-semibold text-[#18181b]">Properti Blok</h2>

          {!selected ? (
            <p className="mt-2 text-xs text-[#a1a1aa]">Pilih blok pada kanvas untuk mengedit.</p>
          ) : (
            <div className="mt-3 space-y-3">
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

              {/* Photo Block Source & Direct Upload */}
              {selected.type === "photo" && (
                <div className="space-y-2">
                  <label className="block text-[11px] text-[#71717a]">
                    URL Foto Publik
                    <div className="mt-0.5 flex gap-1.5">
                      <input
                        type="url"
                        value={selected.publicUrl ?? ""}
                        placeholder="https://res.cloudinary.com/..."
                        onChange={(e) =>
                          mutate(updateBlock(layout, selected.id, { publicUrl: e.target.value }))
                        }
                        className="w-full rounded border border-[#ececee] px-2 py-1 text-[11px]"
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[#ececee] bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]">
                        {uploadingBlockId === selected.id ? (
                          <Loader2 size={12} className="animate-spin text-[#71717a]" />
                        ) : (
                          <Upload size={12} className="text-[#71717a]" />
                        )}
                        <span className="text-[11px]">{uploadingBlockId === selected.id ? "…" : "Unggah"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          disabled={uploadingBlockId === selected.id}
                          className="sr-only"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            try {
                              setUploadingBlockId(selected.id);
                              const url = await uploadImageToCloudinary(file, "portfolio/blocks");
                              mutate(updateBlock(layout, selected.id, { publicUrl: url }));
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "Gagal mengunggah foto");
                            } finally {
                              setUploadingBlockId(null);
                            }
                          }}
                        />
                      </label>
                    </div>
                  </label>

                  {/* Crop / Framing Button */}
                  {selected.publicUrl && (
                    <button
                      type="button"
                      onClick={() => openCropEditor(selected)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#ececee] bg-[#fafafa] px-2.5 py-1.5 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]"
                    >
                      <Crop size={13} /> Atur Posisi / Crop Foto
                    </button>
                  )}

                  <span className="block text-[10px] text-[#a1a1aa]">
                    Unggah gambar langsung ke Cloudinary atau masukkan URL publik.
                  </span>
                </div>
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
        </div>

        {/* ── Page Settings (Metadata & Cover Image) ────────────────────── */}
        <div className="space-y-3 border-t border-[#f4f4f5] pt-3">
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

          {/* Cover Image URL & Direct Upload */}
          <div className="space-y-1">
            <label htmlFor="page-cover" className="block text-[11px] text-[#71717a]">
              Gambar Sampul (Thumbnail)
            </label>
            <div className="flex gap-1.5">
              <input
                id="page-cover"
                type="url"
                value={pageCoverUrl}
                placeholder="https://res.cloudinary.com/... (atau kosongkan)"
                onChange={(e) => {
                  setPageCoverUrl(e.target.value);
                  setSettingsDirty(true);
                  setSettingsSaved(false);
                }}
                className="w-full rounded border border-[#ececee] px-2 py-1 text-xs"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-[#ececee] bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#3f3f46] hover:bg-[#f4f4f5]">
                {uploadingCover ? (
                  <Loader2 size={12} className="animate-spin text-[#71717a]" />
                ) : (
                  <Upload size={12} className="text-[#71717a]" />
                )}
                <span className="text-[11px]">{uploadingCover ? "…" : "Unggah"}</span>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingCover}
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setUploadingCover(true);
                      const url = await uploadImageToCloudinary(file, "portfolio/covers");
                      setPageCoverUrl(url);
                      setSettingsDirty(true);
                      setSettingsSaved(false);
                    } catch (err) {
                      setSettingsError(err instanceof Error ? err.message : "Gagal mengunggah gambar");
                    } finally {
                      setUploadingCover(false);
                    }
                  }}
                />
              </label>
            </div>
            {pageCoverUrl ? (
              <div className="mt-1 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pageCoverUrl}
                  alt="Preview cover"
                  className="h-10 w-14 rounded border border-[#ececee] object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPageCoverUrl("");
                    setSettingsDirty(true);
                    setSettingsSaved(false);
                  }}
                  className="text-[10px] text-red-600 hover:underline"
                >
                  Hapus
                </button>
              </div>
            ) : (
              <p className="mt-0.5 text-[10px] text-[#a1a1aa]">
                Kosongkan untuk otomatis menggunakan foto pertama dari kanvas.
              </p>
            )}
          </div>

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

      {/* ── Multiple Template Sequential Combination Modal ───────────────── */}
      {pendingTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-[#ececee] bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#18181b]">
              <LayoutTemplate size={16} />
              <span>Gunakan Template &quot;{pendingTemplate.label}&quot;</span>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-[#71717a]">
              Kanvas Anda saat ini sudah memiliki {layout.blocks.length} blok. Bagaimana Anda ingin menerapkan template ini?
            </p>

            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => applyTemplateChoice(pendingTemplate.id, "append")}
                className="flex w-full items-center justify-between rounded-xl border border-[#18181b] bg-[#18181b] px-3.5 py-2.5 text-left text-xs font-medium text-white transition-colors hover:bg-[#27272a]"
              >
                <div>
                  <p className="font-semibold">+ Gabungkan di Bawah</p>
                  <p className="text-[10px] text-[#a1a1aa]">Tambahkan secara berurutan di bawah konten saat ini</p>
                </div>
                <Plus size={16} />
              </button>

              <button
                type="button"
                onClick={() => applyTemplateChoice(pendingTemplate.id, "replace")}
                className="flex w-full items-center justify-between rounded-xl border border-[#ececee] bg-white px-3.5 py-2 text-left text-xs font-medium text-[#71717a] transition-colors hover:bg-[#f4f4f5] hover:text-red-600"
              >
                <div>
                  <p className="font-semibold text-red-600">Ganti Seluruh Kanvas</p>
                  <p className="text-[10px] text-[#a1a1aa]">Hapus blok saat ini dan mulai dengan template ini</p>
                </div>
                <Trash2 size={14} className="text-red-500" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setPendingTemplate(null)}
              className="mt-3 w-full rounded-lg py-1.5 text-center text-xs text-[#a1a1aa] hover:text-[#18181b]"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {/* ── Interactive Crop & Positioning Modal ─────────────────────────── */}
      {croppingBlock && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-[#ececee] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#f4f4f5] pb-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#18181b]">
                <Crop size={16} />
                <span>Atur Framing &amp; Posisi Foto ({croppingBlock.w}×{croppingBlock.h} sel)</span>
              </div>
              <button
                type="button"
                onClick={() => setCroppingBlock(null)}
                className="rounded p-1 text-[#71717a] hover:bg-[#f4f4f5]"
              >
                <X size={16} />
              </button>
            </div>

            {/* Live Interactive Preview Box with Exact Aspect Ratio */}
            <div className="mt-4 flex flex-col items-center">
              <p className="mb-2 text-[11px] text-[#71717a]">
                Pratinjau Framing Live (Rasio {croppingBlock.w}:{croppingBlock.h})
              </p>
              <div
                className="relative max-h-[260px] w-full overflow-hidden rounded-xl border border-[#ececee] bg-[#f4f4f5]"
                style={{
                  aspectRatio: `${Math.max(1, croppingBlock.w)} / ${Math.max(1, croppingBlock.h)}`,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={croppingBlock.publicUrl ?? ""}
                  alt=""
                  className="h-full w-full select-none"
                  style={{
                    objectFit: fitMode,
                    objectPosition: `${cropX}% ${cropY}%`,
                    transform: zoom > 1 ? `scale(${zoom})` : undefined,
                    transformOrigin: `${cropX}% ${cropY}%`,
                  }}
                />
              </div>
            </div>

            {/* Sliders & Preset Controls */}
            <div className="mt-4 space-y-3">
              {/* Presets */}
              <div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-[#a1a1aa]">
                  Preset Cepat
                </span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[
                    { label: "Atas", x: 50, y: 10 },
                    { label: "Tengah", x: 50, y: 50 },
                    { label: "Bawah", x: 50, y: 90 },
                    { label: "Kiri", x: 10, y: 50 },
                    { label: "Kanan", x: 90, y: 50 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setCropX(p.x);
                        setCropY(p.y);
                      }}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        cropX === p.x && cropY === p.y
                          ? "border-[#18181b] bg-[#18181b] text-white"
                          : "border-[#ececee] bg-[#fafafa] text-[#52525b] hover:bg-[#f4f4f5]"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Position Sliders */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] text-[#71717a]">
                    <span>Posisi Horisontal (X)</span>
                    <span className="font-mono">{cropX}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropX}
                    onChange={(e) => setCropX(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-[#71717a]">
                    <span>Posisi Vertikal (Y)</span>
                    <span className="font-mono">{cropY}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropY}
                    onChange={(e) => setCropY(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
              </div>

              {/* Zoom & Fit Mode */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="flex justify-between text-[11px] text-[#71717a]">
                    <span>Skala / Zoom</span>
                    <span className="font-mono">{zoom.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="2.5"
                    step="0.1"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <span className="block text-[11px] text-[#71717a]">Mode Fit</span>
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFitMode("cover")}
                      className={`flex-1 rounded border py-1 text-center text-xs font-medium ${
                        fitMode === "cover"
                          ? "border-[#18181b] bg-[#18181b] text-white"
                          : "border-[#ececee] bg-[#fafafa] text-[#52525b]"
                      }`}
                    >
                      Cover
                    </button>
                    <button
                      type="button"
                      onClick={() => setFitMode("contain")}
                      className={`flex-1 rounded border py-1 text-center text-xs font-medium ${
                        fitMode === "contain"
                          ? "border-[#18181b] bg-[#18181b] text-white"
                          : "border-[#ececee] bg-[#fafafa] text-[#52525b]"
                      }`}
                    >
                      Contain
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2 border-t border-[#f4f4f5] pt-3">
              <button
                type="button"
                onClick={() => setCroppingBlock(null)}
                className="rounded-lg border border-[#ececee] px-3 py-1.5 text-xs font-medium text-[#71717a] hover:bg-[#f4f4f5]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={applyCrop}
                className="rounded-lg bg-[#18181b] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#27272a]"
              >
                Terapkan Framing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
