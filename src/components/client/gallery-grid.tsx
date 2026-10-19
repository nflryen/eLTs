"use client";

import { useState, useCallback, useOptimistic, useTransition } from "react";
import { Heart, ZoomIn, Download, LockKeyhole, Loader2 } from "lucide-react";
import { GalleryLightbox } from "./gallery-lightbox";
import {
  toggleFavorite,
  getMediaDownloadUrl,
  submitPhotoSelection,
} from "@/app/actions/client-gallery";

export interface GalleryMediaItem {
  id: string;
  type: "image" | "video";
  file_name: string;
  thumbnail_key: string | null;
  preview_key: string | null;
  width: number | null;
  height: number | null;
}

interface Props {
  items: GalleryMediaItem[];
  projectId: string;
  slug: string;
  initialFavoritedIds: string[];
  allowDownload: boolean;
  selectionQuotaMin?: number;
  selectionQuotaMax?: number;
  selectionLockedAt?: string | null;
}

export function GalleryGrid({
  items,
  projectId,
  slug,
  initialFavoritedIds,
  allowDownload,
  selectionQuotaMin = 15,
  selectionQuotaMax = 20,
  selectionLockedAt = null,
}: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [lockedAt, setLockedAt] = useState<string | null>(selectionLockedAt);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Surfaced when a favorite cannot be persisted, so a failed selection is
  // never mistaken for a successful one.
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "selected">("all");

  const isLocked = Boolean(lockedAt);

  // Optimistic favorites
  const [favoritedIds, toggleOptimistic] = useOptimistic<
    Set<string>,
    { id: string }
  >(
    new Set(initialFavoritedIds),
    (state, action) => {
      const next = new Set(state);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return next;
    },
  );

  const selectedCount = favoritedIds.size;
  const isAtMaxQuota = selectedCount >= selectionQuotaMax;

  const [isPendingFavorite, startFavoriteTransition] = useTransition();

  const handleToggleFavorite = useCallback(
    (id: string) => {
      if (isLocked) return;
      const isAlreadySelected = favoritedIds.has(id);
      if (!isAlreadySelected && favoritedIds.size >= selectionQuotaMax) {
        setFavoriteError(`Maksimal ${selectionQuotaMax} foto dapat dipilih.`);
        return;
      }
      setFavoriteError(null);
      startFavoriteTransition(async () => {
        toggleOptimistic({ id });

        /*
         * The save result was previously discarded, so a failed write still
         * looked successful: the heart stayed filled, no message appeared, and
         * the selection was silently lost on reload.
         *
         * `useOptimistic` unwinds its own state when the transition ends
         * without the underlying source changing, so the optimistic heart
         * reverts by itself — this only needs to report the failure.
         */
        const result = await toggleFavorite(projectId, id, slug);
        if (result.error) setFavoriteError(result.error);
      });
    },
    [isLocked, favoritedIds, selectionQuotaMax, projectId, slug, toggleOptimistic],
  );

  const handleDownload = async (item: GalleryMediaItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await getMediaDownloadUrl(item.id, projectId, slug);
    if (result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = item.file_name;
      a.target = "_blank";
      a.click();
    }
  };

  const handleConfirmSubmit = async () => {
    if (selectedCount < selectionQuotaMin || selectedCount > selectionQuotaMax) {
      setSubmitError(
        `Pilihan foto harus antara ${selectionQuotaMin} hingga ${selectionQuotaMax} foto.`
      );
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitPhotoSelection(projectId, slug);
      if (!result.success) {
        setSubmitError(result.error || "Gagal mengunci pilihan foto.");
        setIsSubmitting(false);
        return;
      }

      setLockedAt(new Date().toISOString());
      setShowConfirmModal(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Terjadi kesalahan saat mengunci pilihan foto.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayedItems =
    filter === "selected"
      ? items.filter((item) => favoritedIds.has(item.id))
      : items;

  if (items.length === 0) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <p className="text-sm">Belum ada foto pada galeri ini. Silakan cek kembali nanti.</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Read-only Lock Banner ────────────────────────────────────────── */}
      {isLocked && (
        <div className="mb-8 rounded-xl border border-amber-200/80 bg-amber-50/90 p-4 sm:p-5 text-amber-950 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <LockKeyhole size={20} />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-semibold tracking-tight text-amber-950">
                Pilihan Foto Telah Dikunci &amp; Masuk Antrean Editing
              </h2>
              <p className="text-xs text-amber-800/90 mt-0.5">
                {selectedCount} foto terpilih sedang diproses oleh tim editor. Perubahan pilihan foto telah dinonaktifkan.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-200/70 px-3 py-1 text-xs font-medium text-amber-900">
              <LockKeyhole size={12} />
              Terkunci
            </span>
          </div>
        </div>
      )}

      {/* ── Filter / Navigation bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-1.5 p-1 bg-zinc-200/60 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              filter === "all"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Semua ({items.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("selected")}
            className={`px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 ${
              filter === "selected"
                ? "bg-white text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Heart
              size={12}
              className={selectedCount > 0 ? "fill-red-500 text-red-500" : ""}
            />
            <span>Dipilih ({selectedCount})</span>
          </button>
        </div>

        {!isLocked && (
          <div className="text-xs text-muted-foreground hidden sm:block">
            Kuota: <strong>{selectionQuotaMin}–{selectionQuotaMax}</strong> foto
          </div>
        )}
      </div>

      {favoriteError && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-3 rounded-lg border border-[#ff5a00]/40 bg-[#ff5a00]/5 px-4 py-3"
        >
          <p className="text-xs text-[#c2410c]">{favoriteError}</p>
          <button
            type="button"
            onClick={() => setFavoriteError(null)}
            className="shrink-0 text-xs underline underline-offset-4 text-[#c2410c]"
          >
            Tutup
          </button>
        </div>
      )}

      {displayedItems.length === 0 && filter === "selected" && (
        <div className="py-20 text-center text-muted-foreground bg-white/50 rounded-xl border border-dashed border-border mb-8">
          <Heart size={28} className="mx-auto mb-2 text-zinc-300" />
          <p className="text-sm font-medium">Belum ada foto yang dipilih</p>
          <p className="text-xs mt-1">
            Klik ikon hati pada foto untuk memilih {selectionQuotaMin}–{selectionQuotaMax} foto untuk diedit.
          </p>
          <button
            type="button"
            onClick={() => setFilter("all")}
            className="mt-4 text-xs underline underline-offset-4 hover:text-foreground"
          >
            Lihat semua foto
          </button>
        </div>
      )}

      {/* ── Masonry Grid ─────────────────────────────────────────────────── */}
      <div
        className="columns-2 sm:columns-3 lg:columns-4 gap-2 space-y-2 pb-24"
        role="list"
        aria-label="Photo gallery"
      >
        {displayedItems.map((item, index) => {
          const isFavorited = favoritedIds.has(item.id);
          const isVideo = item.type === "video";
          const isSelectionDisabled = isLocked || (!isFavorited && isAtMaxQuota);

          return (
            <div
              key={item.id}
              role="listitem"
              className={`break-inside-avoid relative group cursor-pointer overflow-hidden rounded bg-zinc-100 transition-all ${
                isFavorited ? "ring-2 ring-zinc-900 ring-offset-1" : ""
              }`}
              onClick={() => setLightboxIndex(index)}
            >
              {/* Thumbnail */}
              {item.thumbnail_key ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.thumbnail_key}
                  alt={item.file_name}
                  loading="lazy"
                  width={item.width ?? 800}
                  height={item.height ?? 600}
                  className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <div className="w-full aspect-[4/3] bg-zinc-200 flex items-center justify-center text-muted-foreground text-xs">
                  {isVideo ? "▶ Video" : "Image"}
                </div>
              )}

              {/* Video indicator */}
              {isVideo && (
                <span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-medium z-10">
                  VIDEO
                </span>
              )}

              {/* Persistent Selected Badge */}
              {isFavorited && (
                <span className="absolute top-2 right-2 bg-zinc-900 text-white p-1 rounded-full shadow z-10">
                  <Heart size={12} className="fill-red-500 text-red-500" />
                </span>
              )}

              {/* Hover Overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-end p-3">
                <div className="flex items-center gap-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200">
                  {/* View */}
                  <button
                    type="button"
                    aria-label="View full size"
                    className="bg-white/90 hover:bg-white text-zinc-800 rounded p-1.5 transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLightboxIndex(index);
                    }}
                  >
                    <ZoomIn size={15} />
                  </button>

                  {/* Favorite / Selection */}
                  <button
                    type="button"
                    aria-label={
                      isFavorited ? "Remove from selection" : "Add to selection"
                    }
                    disabled={isPendingFavorite || isSelectionDisabled}
                    title={
                      isLocked
                        ? "Pilihan foto telah dikunci"
                        : !isFavorited && isAtMaxQuota
                        ? `Batas maksimal ${selectionQuotaMax} foto telah tercapai`
                        : isFavorited
                        ? "Batalkan pilihan"
                        : "Pilih foto"
                    }
                    className="bg-white/90 hover:bg-white text-zinc-800 rounded p-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFavorite(item.id);
                    }}
                  >
                    <Heart
                      size={15}
                      className={isFavorited ? "fill-red-500 text-red-500" : ""}
                    />
                  </button>

                  {/* Download */}
                  {allowDownload && (
                    <button
                      type="button"
                      aria-label="Download"
                      className="bg-white/90 hover:bg-white text-zinc-800 rounded p-1.5 transition-colors"
                      onClick={(e) => handleDownload(item, e)}
                    >
                      <Download size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Sticky Floating Bottom HUD ───────────────────────────────────── */}
      {!isLocked && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-lg animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-zinc-900/95 text-white backdrop-blur-md px-4 sm:px-5 py-3 rounded-2xl shadow-2xl border border-zinc-800 flex items-center justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="relative flex h-2 w-2 shrink-0">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                      selectedCount >= selectionQuotaMin && selectedCount <= selectionQuotaMax
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                    }`}
                  />
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      selectedCount >= selectionQuotaMin && selectedCount <= selectionQuotaMax
                        ? "bg-emerald-500"
                        : "bg-amber-500"
                    }`}
                  />
                </div>
                <span className="text-xs sm:text-sm font-semibold truncate">
                  Dipilih: {selectedCount} / {selectionQuotaMax} Foto (Minimal {selectionQuotaMin})
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 truncate">
                {selectedCount < selectionQuotaMin
                  ? `Kurang ${selectionQuotaMin - selectedCount} foto lagi untuk memenuhi kuota minimal`
                  : selectedCount >= selectionQuotaMax
                  ? "Batas kuota maksimal tercapai. Siap untuk dikunci!"
                  : "Kuota terpenuhi. Pilihan dapat dikunci atau ditambah."}
              </p>
            </div>

            <div className="relative group shrink-0">
              <button
                type="button"
                disabled={
                  selectedCount < selectionQuotaMin ||
                  isPendingFavorite ||
                  isSubmitting
                }
                onClick={() => setShowConfirmModal(true)}
                title={
                  selectedCount < selectionQuotaMin
                    ? `Pilih minimal ${selectionQuotaMin} foto untuk mengunci pilihan (Kurang ${
                        selectionQuotaMin - selectedCount
                      } foto)`
                    : "Kunci dan kirim pilihan foto ke antrean editing"
                }
                className="bg-white text-zinc-900 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-white disabled:cursor-not-allowed font-medium px-3.5 sm:px-4 py-2 rounded-xl text-xs sm:text-sm transition-all shadow-sm flex items-center gap-1.5"
              >
                <LockKeyhole size={14} />
                <span>Kunci Pilihan</span>
              </button>

              {/* Tooltip hint when disabled */}
              {selectedCount < selectionQuotaMin && (
                <div className="hidden group-hover:block absolute bottom-full right-0 mb-2 w-52 p-2 bg-zinc-800 text-[11px] text-zinc-200 rounded-lg shadow-lg border border-zinc-700 text-center pointer-events-none z-50">
                  Minimal {selectionQuotaMin} foto diperlukan sebelum mengunci (kurang {selectionQuotaMin - selectedCount} foto lagi)
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Confirmation Modal ───────────────────────────────────────────── */}
      {showConfirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-modal-title"
        >
          <div className="relative w-full max-w-md bg-white rounded-xl shadow-2xl p-6 border border-zinc-200 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800">
                <LockKeyhole size={20} />
              </div>
              <div>
                <h3
                  id="confirm-modal-title"
                  className="text-base font-semibold text-zinc-900"
                >
                  Kunci &amp; Kirim Pilihan Foto?
                </h3>
                <p className="text-xs text-zinc-500">
                  Konfirmasi seleksi foto final untuk proses editing
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-zinc-50 p-4 border border-zinc-100 text-sm text-zinc-700 space-y-2">
              <div className="flex justify-between items-center text-xs text-zinc-600">
                <span>Jumlah Foto Terpilih:</span>
                <span className="font-semibold text-zinc-900">
                  {selectedCount} dari kuota {selectionQuotaMin}–{selectionQuotaMax} foto
                </span>
              </div>
              <p className="text-xs text-amber-800 bg-amber-50/80 p-2.5 rounded border border-amber-200/70 leading-relaxed">
                ⚠️ <strong>Perhatian:</strong> Setelah dikunci, pilihan foto <strong>tidak dapat diubah kembali</strong> dan akan langsung dimasukkan ke antrean tim editing kami.
              </p>
            </div>

            {submitError && (
              <div className="rounded-md bg-red-50 p-3 text-xs text-red-700 border border-red-200">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setShowConfirmModal(false);
                  setSubmitError(null);
                }}
                className="px-4 py-2 text-xs sm:text-sm font-medium text-zinc-700 hover:bg-zinc-100 rounded-md transition-colors disabled:opacity-50"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmSubmit}
                className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-zinc-900 hover:bg-zinc-800 rounded-md transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Mengunci...</span>
                  </>
                ) : (
                  <>
                    <LockKeyhole size={14} />
                    <span>Ya, Kunci &amp; Kirim</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ─────────────────────────────────────────────────────── */}
      {lightboxIndex !== null && (
        <GalleryLightbox
          items={displayedItems}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          favoritedIds={favoritedIds}
          onToggleFavorite={handleToggleFavorite}
          projectId={projectId}
          slug={slug}
          allowDownload={allowDownload}
        />
      )}
    </>
  );
}
