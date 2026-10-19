"use client";

import { useEffect, useCallback, useRef } from "react";
import { X, ChevronLeft, ChevronRight, Download, Heart } from "lucide-react";
import { getMediaDownloadUrl } from "@/app/actions/client-gallery";
import type { GalleryMediaItem } from "./gallery-grid";

interface Props {
  items: GalleryMediaItem[];
  activeIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  favoritedIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  projectId: string;
  slug: string;
  allowDownload: boolean;
}

export function GalleryLightbox({
  items,
  activeIndex,
  onClose,
  onNavigate,
  favoritedIds,
  onToggleFavorite,
  projectId,
  slug,
  allowDownload,
}: Props) {
  const item = items[activeIndex];
  const containerRef = useRef<HTMLDivElement>(null);

  // Touch swipe support
  const touchStartX = useRef<number | null>(null);

  const goNext = useCallback(() => {
    if (activeIndex < items.length - 1) onNavigate(activeIndex + 1);
  }, [activeIndex, items.length, onNavigate]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) onNavigate(activeIndex - 1);
  }, [activeIndex, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  // Focus trap
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  const handleDownload = async () => {
    if (!item) return;
    const result = await getMediaDownloadUrl(item.id, projectId, slug);
    if (result.url) {
      const a = document.createElement("a");
      a.href = result.url;
      a.download = item.file_name;
      a.target = "_blank";
      a.click();
    }
  };

  if (!item) return null;

  const isFavorited = favoritedIds.has(item.id);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      ref={containerRef}
      tabIndex={-1}
      onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchStartX.current === null) return;
        const diff = touchStartX.current - e.changedTouches[0].clientX;
        if (diff > 60) goNext();
        else if (diff < -60) goPrev();
        touchStartX.current = null;
      }}
    >
      {/* Top Controls */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-4 z-10">
        <p className="text-white/60 text-sm">
          {activeIndex + 1} / {items.length}
        </p>
        <div className="flex items-center gap-2">
          {/* Favorite */}
          <button
            type="button"
            aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
            onClick={() => onToggleFavorite(item.id)}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <Heart
              size={20}
              className={
                isFavorited
                  ? "fill-red-500 text-red-500"
                  : "text-white/70 hover:text-white"
              }
            />
          </button>

          {/* Download */}
          {allowDownload && (
            <button
              type="button"
              aria-label="Download"
              onClick={handleDownload}
              className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70 hover:text-white"
            >
              <Download size={20} />
            </button>
          )}

          {/* Close */}
          <button
            type="button"
            aria-label="Close viewer"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors text-white/70 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Prev button */}
      {activeIndex > 0 && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={goPrev}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Next button */}
      {activeIndex < items.length - 1 && (
        <button
          type="button"
          aria-label="Next photo"
          onClick={goNext}
          className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/40 hover:bg-black/70 text-white transition-colors"
        >
          <ChevronRight size={28} />
        </button>
      )}

      {/* Media */}
      <div className="w-full h-full flex items-center justify-center px-14 py-16">
        {item.type === "video" ? (
          <video
            key={item.id}
            src={item.preview_key ?? item.thumbnail_key ?? ""}
            controls
            className="max-w-full max-h-full rounded"
            autoPlay
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.id}
            src={item.preview_key ?? item.thumbnail_key ?? ""}
            alt={item.file_name}
            className="max-w-full max-h-full object-contain select-none"
            draggable={false}
          />
        )}
      </div>

      {/* Bottom caption */}
      <div className="absolute bottom-0 left-0 right-0 px-4 py-4 text-center">
        <p className="text-white/40 text-xs">{item.file_name}</p>
      </div>
    </div>
  );
}
