"use client";

import Image from "next/image";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, X, Expand, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { HomepageFeaturedWork } from "@/lib/portfolio/homepage";
import { featuredWorks as staticFallback } from "@/content/photography";

interface FeaturedWorksProps {
  items?: HomepageFeaturedWork[];
}

export function FeaturedWorks({ items }: FeaturedWorksProps) {
  const rail = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // If dynamic items are passed, use them; otherwise use curated static fallback
  const works: HomepageFeaturedWork[] =
    items && items.length > 0
      ? items
      : staticFallback.map((f) => ({
          id: f.id,
          src: f.src,
          alt: f.alt,
          title: f.title,
          category: f.category,
          slug: "risma-her-gang",
        }));

  const active = selected === null ? null : works[selected];

  const step = (direction: number) =>
    setSelected((current) =>
      current === null
        ? 0
        : (current + direction + works.length) % works.length
    );

  return (
    <section id="portfolio" className="section-space overflow-hidden">
      <div className="site-container mb-9 flex items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Through our lens</p>
          <h2 className="section-title mt-4">Featured works</h2>
        </div>
        <div className="flex gap-2">
          <Button
            size="icon"
            variant="outline"
            aria-label="Scroll to previous photographs"
            onClick={() =>
              rail.current?.scrollBy({ left: -450, behavior: "smooth" })
            }
          >
            <ArrowLeft />
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="Scroll to next photographs"
            onClick={() =>
              rail.current?.scrollBy({ left: 450, behavior: "smooth" })
            }
          >
            <ArrowRight />
          </Button>
        </div>
      </div>

      <Dialog.Root
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <div
          ref={rail}
          className="portfolio-rail flex snap-x snap-mandatory gap-5 overflow-x-auto pb-5 scroll-smooth no-scrollbar"
          aria-label="Featured photography"
        >
          {works.map((work, index) => (
            <button
              key={work.id}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(index);
              }}
              className={`portfolio-item group relative shrink-0 snap-start overflow-hidden rounded-[var(--radius-cards)] border border-[var(--color-cloud)] text-left cursor-zoom-in ${
                index % 3 === 1 ? "portfolio-wide" : ""
              }`}
              aria-haspopup="dialog"
              aria-label={`View ${work.title}`}
            >
              <Image
                src={work.src}
                alt={work.alt}
                fill
                sizes="(max-width: 640px) 75vw, 450px"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 select-none"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent opacity-80 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="absolute right-5 bottom-5 left-5 flex items-end justify-between text-white">
                <div>
                  <span className="mb-2 inline-block text-[11px] font-mono tracking-[0.14em] uppercase text-white/80">
                    {work.category}
                  </span>
                  <h3 className="text-[18px] sm:text-[20px] font-semibold leading-[1.3] text-white">
                    {work.title}
                  </h3>
                </div>
                <div className="rounded-full bg-white/20 p-2 backdrop-blur-xs text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <Expand size={16} />
                </div>
              </div>
            </button>
          ))}
        </div>

        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-60 bg-[var(--color-obsidian)]/97 backdrop-blur-md" />
          <Dialog.Content
            className="fixed inset-0 z-60 flex flex-col p-4 text-white outline-none sm:p-8 select-none"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus({ preventScroll: true });
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                step(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                step(-1);
              }
            }}
            onTouchStart={(event) => {
              touchStart.current = event.touches[0].clientX;
            }}
            onTouchEnd={(event) => {
              if (touchStart.current !== null) {
                const distance =
                  event.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(distance) > 55) step(distance < 0 ? 1 : -1);
                touchStart.current = null;
              }
            }}
          >
            <div className="flex items-center justify-between text-white/70">
              <span className="font-mono text-xs text-white/70 font-semibold px-2.5 py-1 rounded-full bg-white/10 border border-white/15">
                {selected !== null ? selected + 1 : 1} / {works.length}
              </span>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Tutup foto"
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                >
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>

            <div className="relative my-auto flex flex-1 items-center justify-center p-2 sm:p-4">
              {active ? (
                <div className="relative h-[70vh] sm:h-[75vh] w-full max-w-5xl flex items-center justify-center">
                  <Image
                    key={active.id}
                    src={active.src}
                    alt={active.alt}
                    fill
                    sizes="(max-width: 1024px) 95vw, 1200px"
                    className="object-contain transition-opacity duration-300 select-none shadow-2xl"
                    priority
                  />
                </div>
              ) : null}

              {works.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Foto sebelumnya"
                    onClick={() => step(-1)}
                    className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95 cursor-pointer border border-white/15"
                  >
                    <ArrowLeft size={20} />
                  </button>
                  <button
                    type="button"
                    aria-label="Foto berikutnya"
                    onClick={() => step(1)}
                    className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white backdrop-blur-sm transition-all hover:bg-white/20 active:scale-95 cursor-pointer border border-white/15"
                  >
                    <ArrowRight size={20} />
                  </button>
                </>
              ) : null}
            </div>

            {active ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-center sm:text-left pt-2 border-t border-white/10">
                <div>
                  <p className="text-xs font-mono tracking-[0.14em] uppercase text-white/60">
                    {active.category}
                  </p>
                  <Dialog.Title className="mt-0.5 text-base sm:text-lg font-semibold text-white">
                    {active.title}
                  </Dialog.Title>
                </div>
                {active.slug && (
                  <Link
                    href={`/portfolio/${active.slug}`}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#09090b] text-xs font-semibold hover:bg-white/90 transition-colors"
                  >
                    <span>Buka Cerita Showcase</span>
                    <ExternalLink size={13} />
                  </Link>
                )}
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
