"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { normaliseLayout, type LayoutBlock } from "@/lib/portfolio/layout";
import { CanvasRenderer } from "./canvas-renderer";
import type { PortfolioSectionRow } from "@/app/actions/portfolio";

interface LightboxPhoto {
  id: string;
  url: string;
  blockId: string;
  sectionId: string;
}

interface ShowcaseViewerProps {
  page: {
    id: string;
    title: string;
    slug: string;
    summary?: string | null;
  };
  sections: PortfolioSectionRow[];
}

export function ShowcaseViewer({ page, sections }: ShowcaseViewerProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Normalise all section layouts and extract photo blocks in exact reading order
  const normalisedSections = useMemo(() => {
    return sections.map((sec) => ({
      ...sec,
      normalisedLayout: normaliseLayout(sec.layout),
    }));
  }, [sections]);

  const allPhotos: LightboxPhoto[] = useMemo(() => {
    const list: LightboxPhoto[] = [];
    for (const sec of normalisedSections) {
      const blocks = sec.normalisedLayout.blocks;
      // Sort in visual reading order: row then col
      const sorted = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
      for (const b of sorted) {
        if (b.type === "photo" && b.publicUrl) {
          list.push({
            id: `${sec.id}-${b.id}`,
            blockId: b.id,
            sectionId: sec.id,
            url: b.publicUrl,
          });
        }
      }
    }
    return list;
  }, [normalisedSections]);

  const activePhoto = selectedIndex !== null ? allPhotos[selectedIndex] ?? null : null;

  const step = useCallback(
    (direction: number) => {
      setSelectedIndex((curr) => {
        if (curr === null || allPhotos.length === 0) return null;
        return (curr + direction + allPhotos.length) % allPhotos.length;
      });
    },
    [allPhotos.length]
  );

  const close = useCallback(() => {
    setSelectedIndex(null);
  }, []);

  // Keyboard navigation: ArrowLeft, ArrowRight, Escape
  useEffect(() => {
    if (selectedIndex === null) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [selectedIndex, step, close]);

  const handlePhotoClick = (block: LayoutBlock, sectionId: string) => {
    const idx = allPhotos.findIndex(
      (p) => p.blockId === block.id && p.sectionId === sectionId
    );
    if (idx !== -1) {
      setSelectedIndex(idx);
    }
  };

  return (
    <>
      {/* Sections Grid Rendering */}
      <div className="space-y-16">
        {normalisedSections.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            This page has no sections yet.
          </p>
        ) : (
          normalisedSections.map((sec) => (
            <CanvasRenderer
              key={sec.id}
              layout={sec.normalisedLayout}
              onPhotoClick={(block) => handlePhotoClick(block, sec.id)}
            />
          ))
        )}
      </div>

      {/* Fullscreen Interactive Lightbox Modal */}
      {activePhoto && selectedIndex !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Penampil Foto Layar Penuh"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-4 sm:p-6 select-none animate-in fade-in duration-200"
          onClick={close}
        >
          {/* Top Bar with Counter and Close Button */}
          <div
            className="absolute top-4 left-4 right-4 sm:top-6 sm:left-6 sm:right-6 flex items-center justify-between text-white z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-xs font-semibold px-2.5 py-1 rounded-full bg-white/10 text-white/90 border border-white/15">
                {selectedIndex + 1} / {allPhotos.length}
              </span>
              <span className="text-xs text-white/70 font-medium truncate max-w-[200px] sm:max-w-md">
                {page.title}
              </span>
            </div>

            <button
              type="button"
              onClick={close}
              aria-label="Tutup penampil foto (Esc)"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/90 hover:text-white text-xs font-medium transition-colors cursor-pointer border border-white/15"
            >
              <span className="hidden sm:inline text-[11px] text-white/60 font-mono">ESC</span>
              <X size={16} />
            </button>
          </div>

          {/* Navigation Controls: Previous */}
          {allPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Foto sebelumnya (Panah Kiri)"
              className="absolute left-4 sm:left-6 top-1/2 -translate-y-1/2 z-10 p-3 sm:p-3.5 rounded-full bg-white/10 hover:bg-white/25 text-white/90 hover:text-white backdrop-blur-sm border border-white/15 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
            >
              <ArrowLeft size={20} />
            </button>
          )}

          {/* Main Uncropped Image Frame */}
          <div
            className="relative max-h-[85vh] max-w-[90vw] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={activePhoto.id}
              src={activePhoto.url}
              alt={`${page.title} — Foto ${selectedIndex + 1}`}
              className="max-h-[85vh] max-w-[90vw] object-contain shadow-2xl rounded-sm transition-opacity duration-300"
              draggable={false}
            />
          </div>

          {/* Navigation Controls: Next */}
          {allPhotos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Foto berikutnya (Panah Kanan)"
              className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 z-10 p-3 sm:p-3.5 rounded-full bg-white/10 hover:bg-white/25 text-white/90 hover:text-white backdrop-blur-sm border border-white/15 transition-all duration-200 hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
            >
              <ArrowRight size={20} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
