import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AboutCollageSet } from "@/lib/portfolio/homepage";
import { DEFAULT_ABOUT_COLLAGE } from "@/lib/portfolio/homepage";

interface AboutPreviewProps {
  photos?: AboutCollageSet;
}

/*
 * Awesomic about section: light canvas, editorial two-column, photography as a
 * structural element with generous rounding (not a backdrop).
 *
 * Dynamically renders rotational photography from published portfolio showcases
 * with a deterministic rotation schedule and clean fallback.
 */
export function AboutPreview({ photos }: AboutPreviewProps) {
  const collage = photos ?? DEFAULT_ABOUT_COLLAGE;

  return (
    <section
      id="about"
      className="site-container section-space grid items-center gap-14 lg:grid-cols-[1fr_1fr] lg:gap-20"
    >
      <div className="grid grid-cols-[1.6fr_1fr] items-end gap-4">
        {collage.primary.slug ? (
          <Link
            href={`/portfolio/${collage.primary.slug}`}
            className="group relative aspect-[.78] overflow-hidden rounded-[var(--radius-cards)] bg-[var(--color-cloud)] border border-[var(--color-cloud)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b]"
            aria-label={`Lihat showcase ${collage.primary.title || "portfolio"}`}
          >
            <Image
              src={collage.primary.src}
              alt={collage.primary.alt}
              fill
              sizes="(max-width: 768px) 55vw, 340px"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 select-none"
            />
          </Link>
        ) : (
          <div className="group relative aspect-[.78] overflow-hidden rounded-[var(--radius-cards)] bg-[var(--color-cloud)] border border-[var(--color-cloud)]">
            <Image
              src={collage.primary.src}
              alt={collage.primary.alt}
              fill
              sizes="(max-width: 768px) 55vw, 340px"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 select-none"
            />
          </div>
        )}

        {collage.secondary.slug ? (
          <Link
            href={`/portfolio/${collage.secondary.slug}`}
            className="group relative aspect-[.67] overflow-hidden rounded-[var(--radius-cards)] bg-[var(--color-cloud)] border border-[var(--color-cloud)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#09090b]"
            aria-label={`Lihat showcase ${collage.secondary.title || "portfolio"}`}
          >
            <Image
              src={collage.secondary.src}
              alt={collage.secondary.alt}
              fill
              sizes="(max-width: 768px) 30vw, 200px"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 select-none"
            />
          </Link>
        ) : (
          <div className="group relative aspect-[.67] overflow-hidden rounded-[var(--radius-cards)] bg-[var(--color-cloud)] border border-[var(--color-cloud)]">
            <Image
              src={collage.secondary.src}
              alt={collage.secondary.alt}
              fill
              sizes="(max-width: 768px) 30vw, 200px"
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-105 select-none"
            />
          </div>
        )}
      </div>

      <div className="max-w-md">
        <p className="eyebrow">About Elts.</p>
        <h2 className="section-title mt-4">More than just photos</h2>
        <p className="mt-6 text-[15px] leading-[1.45] text-[var(--color-graphite)]">
          Every photograph is more than an image. It is a memory, a feeling, and
          a story worth keeping.
        </p>
        <p className="mt-4 text-[15px] leading-[1.45] text-[var(--color-steel)]">
          From the quiet in-between moments to the once-in-a-lifetime ones, we
          capture your story just as it feels. Honest, effortless, and entirely
          yours.
        </p>
        <Button asChild className="mt-8">
          <Link href="/contact">
            Tell us your story <ArrowRight />
          </Link>
        </Button>
      </div>
    </section>
  );
}
