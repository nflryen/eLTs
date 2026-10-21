"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, X, Expand } from "lucide-react";
import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { portfolioGallery } from "@/content/photography";
import type { PhotographyType, PortfolioImage } from "@/types/portfolio";

type Filter = "all" | PhotographyType;

const FILTERS: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Wedding", value: "wedding" },
  { label: "Prewedding", value: "prewedding" },
  { label: "Graduation", value: "graduation" },
  { label: "Couple", value: "couple" },
  { label: "Event", value: "event" },
];

// Aspect ratios for masonry-like feel
const aspectClass: Record<NonNullable<PortfolioImage["aspect"]>, string> = {
  portrait: "aspect-[3/4]",
  landscape: "aspect-[4/3]",
  square: "aspect-square",
};

export function PortfolioGrid() {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const touchStart = useRef<number | null>(null);

  const visible = portfolioGallery.filter(
    (img) => filter === "all" || img.category === filter,
  );

  const active = selected === null ? null : visible[selected] ?? null;

  const step = useCallback(
    (direction: number) => {
      setSelected((curr) =>
        curr === null
          ? 0
          : (curr + direction + visible.length) % visible.length,
      );
    },
    [visible.length],
  );

  return (
    <div>
      {/* Filter Tabs */}
      <div
        role="tablist"
        aria-label="Filter portfolio by category"
        className="mb-12 flex flex-wrap items-center gap-2 border-b border-border pb-6"
      >
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            id={`filter-${f.value}`}
            onClick={() => {
              setFilter(f.value);
              setSelected(null);
            }}
            className={`rounded-[var(--radius-badges)] border px-3 py-1.5 text-[13px] transition-colors ${
              filter === f.value
                ? "border-[var(--color-graphite)] bg-[var(--color-graphite)] text-white"
                : "border-[var(--color-cloud)] text-[var(--color-graphite)] hover:border-[var(--color-mist)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-[var(--color-fog)]">
          {visible.length} {visible.length === 1 ? "photo" : "photos"}
        </span>
      </div>

      {/* Masonry Grid */}
      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <div
          className="columns-2 gap-4 md:columns-3 lg:columns-3 xl:columns-4"
          aria-label="Portfolio gallery"
        >
          {visible.map((img, index) => (
            <Dialog.Trigger asChild key={img.id}>
              <button
                onClick={(event) => {
                  opener.current = event.currentTarget;
                  setSelected(index);
                }}
                className={`group relative mb-4 block w-full overflow-hidden ${
                  img.aspect ? aspectClass[img.aspect] : "aspect-[3/4]"
                }`}
                aria-label={`View ${img.title}`}
                aria-haspopup="dialog"
              >
                <Image
                  src={img.src}
                  alt={img.alt}
                  fill
                  sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent opacity-0 transition-opacity duration-400 group-hover:opacity-100" />
                <div className="absolute inset-0 flex flex-col justify-end p-4 opacity-0 transition-opacity duration-400 group-hover:opacity-100">
                  <p className="text-[10px] tracking-[.18em] uppercase text-white/70">
                    {img.category}
                  </p>
                  <h3 className="mt-1 text-lg leading-tight text-white">
                    {img.title}
                  </h3>
                </div>
                <div className="absolute top-3 right-3 opacity-0 transition-opacity duration-400 group-hover:opacity-100">
                  <Expand size={15} className="text-white drop-shadow" />
                </div>
              </button>
            </Dialog.Trigger>
          ))}
        </div>

        {/* Lightbox */}
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-60 bg-[#131311]/97" />
          <Dialog.Content
            className="fixed inset-0 z-60 flex flex-col p-4 text-white outline-none sm:p-8"
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              opener.current?.focus({ preventScroll: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                step(1);
              }
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                step(-1);
              }
            }}
            onTouchStart={(e) => {
              touchStart.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (touchStart.current !== null) {
                const dist =
                  e.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(dist) > 50) step(dist < 0 ? 1 : -1);
                touchStart.current = null;
              }
            }}
          >
            {/* Top bar */}
            <div className="flex items-start justify-between gap-6">
              <div>
                <Dialog.Title className="text-3xl">
                  {active?.title}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs tracking-[.15em] uppercase text-white/50">
                  {active?.category} &middot;{" "}
                  {selected === null ? 0 : selected + 1} / {visible.length}
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  size="icon"
                  className="bg-white/10 hover:bg-white/20"
                  aria-label="Close photo viewer"
                >
                  <X />
                </Button>
              </Dialog.Close>
            </div>

            {/* Image */}
            <div className="relative my-5 min-h-0 flex-1">
              {active && (
                <Image
                  key={active.id}
                  src={active.src}
                  alt={active.alt}
                  fill
                  sizes="95vw"
                  className="object-contain"
                  priority
                />
              )}
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-center gap-8">
              <Button
                size="icon"
                className="bg-white/10 hover:bg-white/20"
                onClick={() => step(-1)}
                aria-label="Previous photograph"
              >
                <ArrowLeft />
              </Button>
              <p className="text-xs text-white/50">
                {active?.category && (
                  <span className="capitalize">{active.category}</span>
                )}{" "}
                &middot; A moment worth keeping.
              </p>
              <Button
                size="icon"
                className="bg-white/10 hover:bg-white/20"
                onClick={() => step(1)}
                aria-label="Next photograph"
              >
                <ArrowRight />
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Empty state */}
      {visible.length === 0 && (
        <div className="flex flex-col items-center py-24 text-center">
          <p className="text-[20px] font-semibold text-[var(--color-fog)]">
            No photos in this category yet.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Check back soon — more work is on its way.
          </p>
        </div>
      )}
    </div>
  );
}
