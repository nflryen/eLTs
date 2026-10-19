"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * Bottom sheet shell.
 *
 * Slides up from the bottom edge with a drag handle. Two behaviours matter for
 * it to feel native rather than like a web modal:
 *
 *   1. Motion respects `prefers-reduced-motion` — the sheet still opens, it just
 *      does not animate.
 *   2. Dismissal is forgiving: tapping the scrim, pressing Escape, or dragging
 *      the handle down past a threshold all close it.
 */

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const startY = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the sheet owns the screen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button
        type="button"
        aria-label="Tutup"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-[#09090b]/40"
      />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-[28px] border-t border-[#ececee] bg-white motion-safe:animate-[sheet-up_240ms_cubic-bezier(0.32,0.72,0,1)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none items-center justify-center py-2"
          onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            if (startY.current === null) return;
            const delta = e.changedTouches[0].clientY - startY.current;
            if (delta > 96) onClose();
            startY.current = null;
          }}
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-[#d4d4d8]" />
        </div>

        <div className="flex items-center justify-between px-5 pb-2">
          <h2 id={labelledBy} className="text-sm font-semibold text-[#09090b]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-[12px] text-[#52525b] hover:bg-[#fafafa]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">{children}</div>
      </div>
    </div>
  );
}
