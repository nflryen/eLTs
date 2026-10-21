import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Awesomic about section: light canvas, editorial two-column, photography as a
 * structural element with generous rounding (not a backdrop).
 */
export function AboutPreview() {
  return (
    <section
      id="about"
      className="site-container section-space grid items-center gap-14 lg:grid-cols-[1fr_1fr] lg:gap-20"
    >
      <div className="grid grid-cols-[1.6fr_1fr] items-end gap-4">
        <div className="relative aspect-[.78] overflow-hidden rounded-[var(--radius-cards)]">
          <Image
            src="/images/bride.webp"
            alt="A bride holding a bouquet in a quiet, reflective moment"
            fill
            sizes="(max-width: 768px) 55vw, 340px"
            className="object-cover"
          />
        </div>
        <div className="relative aspect-[.67] overflow-hidden rounded-[var(--radius-cards)]">
          <Image
            src="/images/hands.webp"
            alt="The gentle details of a wedding day: two hands held together"
            fill
            sizes="(max-width: 768px) 30vw, 200px"
            className="object-cover"
          />
        </div>
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
