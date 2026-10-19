import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "@/components/shared/section-title";
import { bookingUrl } from "@/config/site";

export function AboutPreview() {
  return (
    <section
      id="about"
      className="site-container section-space grid items-center gap-14 lg:grid-cols-[1.15fr_1fr] lg:gap-24"
    >
      <div className="about-collage grid grid-cols-[1.65fr_1fr] items-end gap-4 sm:gap-6">
        <div className="relative aspect-[.76] overflow-hidden">
          <Image
            src="/images/bride.webp"
            alt="A bride holding a bouquet in a quiet, reflective moment"
            fill
            sizes="(max-width: 768px) 55vw, 340px"
            className="object-cover"
          />
        </div>
        <div className="pb-1">
          <div className="relative aspect-[.67] overflow-hidden">
            <Image
              src="/images/hands.webp"
              alt="The gentle details of a wedding day: two hands held together"
              fill
              sizes="(max-width: 768px) 30vw, 200px"
              className="object-cover"
            />
          </div>
          <p className="mt-4 rotate-[-4deg] font-serif text-xl italic text-[#706b63]">
            for the real moments.
          </p>
        </div>
      </div>
      <div className="max-w-md">
        <SectionTitle eyebrow="About Elts.">
          More Than
          <br />
          <span className="italic">Just Photos.</span>
        </SectionTitle>
        <p className="mt-6 leading-relaxed text-muted-foreground">
          At Elts., we believe every photograph is more than an image. It is a
          memory, a feeling, and a story worth keeping.
        </p>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          From the quiet in-between moments to the once-in-a-lifetime ones, we
          capture your story just as it feels. Honest, effortless, and entirely
          yours.
        </p>
        <Button asChild className="mt-8">
          <a href={bookingUrl()} target="_blank" rel="noopener noreferrer">
            Let’s Tell Your Story <ArrowRight />
          </a>
        </Button>
      </div>
    </section>
  );
}
