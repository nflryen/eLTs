"use client";

import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeft, ArrowRight, X, Expand } from "lucide-react";
import { useRef, useState } from "react";
import { featuredWorks } from "@/content/photography";
import { Button } from "@/components/ui/button";

export function FeaturedWorks() {
  const rail = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected === null ? null : featuredWorks[selected];
  const step = (direction: number) =>
    setSelected((current) =>
      current === null
        ? 0
        : (current + direction + featuredWorks.length) % featuredWorks.length,
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
          className="portfolio-rail flex snap-x snap-mandatory gap-5 overflow-x-auto pb-5"
          aria-label="Featured photography"
        >
          {featuredWorks.map((work, index) => (
            <button
              key={work.id}
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(index);
              }}
              className={`portfolio-item group relative shrink-0 snap-start overflow-hidden rounded-[var(--radius-cards)] border border-[var(--color-cloud)] text-left ${index % 3 === 1 ? "portfolio-wide" : ""}`}
              aria-haspopup="dialog"
              aria-label={`View ${work.title}`}
            >
              <Image
                src={work.src}
                alt={work.alt}
                fill
                sizes="(max-width: 640px) 75vw, 450px"
                className="object-cover transition-transform duration-700 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-70 transition-opacity group-hover:opacity-100" />
              <div className="absolute right-5 bottom-5 left-5 flex items-end justify-between text-white">
                <div>
                  <p className="mb-2 text-[12px] tracking-[0.14em] uppercase">
                    {work.category}
                  </p>
                  <h3 className="text-[20px] font-semibold leading-[1.5]">{work.title}</h3>
                </div>
                <Expand size={17} />
              </div>
            </button>
          ))}
        </div>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-60 bg-[var(--color-obsidian)]/97" />
          <Dialog.Content
            className="fixed inset-0 z-60 flex flex-col p-4 text-white outline-none sm:p-8"
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
            <div className="flex items-start justify-between gap-6">
              <div>
                <Dialog.Title className="text-3xl">
                  {active?.title}
                </Dialog.Title>
                <Dialog.Description className="mt-2 text-sm text-white/60">
                  Elts. visual collection ·{" "}
                  {selected === null ? 0 : selected + 1} /{" "}
                  {featuredWorks.length}
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
            <div className="relative my-5 min-h-0 flex-1">
              {active && (
                <Image
                  key={active.id}
                  src={active.src}
                  alt={active.alt}
                  fill
                  sizes="95vw"
                  className="object-contain"
                />
              )}
            </div>
            <div className="flex items-center justify-center gap-8">
              <Button
                size="icon"
                className="bg-white/10 hover:bg-white/20"
                onClick={() => step(-1)}
                aria-label="Previous photograph"
              >
                <ArrowLeft />
              </Button>
              <p className="text-xs text-white/60">A moment worth keeping.</p>
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
    </section>
  );
}
