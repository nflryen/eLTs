import Image from "next/image";
import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingCta } from "@/components/home/booking-cta";
import { bookingUrl } from "@/config/site";

export const metadata: Metadata = {
  title: "About — More Than Just Photos",
  description:
    "At Elts., we believe every photograph is more than an image. It is a memory, a feeling, and a story worth keeping. Learn about our approach.",
  alternates: { canonical: "/about" },
};

const values = [
  {
    number: "01",
    title: "Authentic",
    description:
      "We never manufacture emotion. Every image we make is an honest reflection of the moment as it happened.",
  },
  {
    number: "02",
    title: "Intentional",
    description:
      "We approach every session with care and purpose — from the light we choose to the moments we wait for.",
  },
  {
    number: "03",
    title: "Present",
    description:
      "We show up fully for each client. Your story gets our complete attention, not a template.",
  },
  {
    number: "04",
    title: "Timeless",
    description:
      "We edit and compose with longevity in mind — photographs that look as meaningful in twenty years as they do today.",
  },
];

export default function AboutPage() {
  return (
    <main id="main-content">
      {/* Hero */}
      <section className="relative isolate overflow-hidden text-white" style={{ minHeight: "480px" }}>
        <Image
          src="/images/hero.webp"
          alt="Elts. — photography for real moments"
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_30%]"
        />
        {/*
          Two layers, not one: a directional gradient for depth plus a flat
          scrim over the lower third where the headline actually sits. A single
          left-to-right gradient left the bottom-left corner at 75% opacity over
          an already-dark photograph, which is fine, but it gave no guarantee
          once the image is swapped. The scrim makes the text legible for ANY
          photo, which is the actual requirement.
        */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#09090b]/80 via-[#09090b]/55 to-[#09090b]/25" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#09090b]/85 to-transparent" />
        <div className="site-container relative flex items-end pb-16 pt-28 sm:pt-36">
          <div>
            <p className="eyebrow text-white/80!">About Elts.</p>
            <h1 className="section-heading mt-5 text-white">
              More Than
              <br />
              Just Photos.
            </h1>
          </div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="site-container section-space grid items-center gap-14 lg:grid-cols-[1fr_1.1fr] lg:gap-24">
        <div>
          <p className="eyebrow">Our philosophy</p>
          <h2 className="section-heading mt-5">
            We capture
            <br />
            <span className="italic">authentic stories.</span>
          </h2>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            At Elts., we believe every photograph is more than an image. It is a
            memory, a feeling, and a story worth keeping.
          </p>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            We were founded on the belief that photography should feel like
            nothing — invisible, effortless, and true. When you look at your
            images years from now, you shouldn&apos;t remember us. You should
            remember how you felt.
          </p>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            From the quiet in-between moments to the once-in-a-lifetime ones, we
            capture your story just as it feels — honest, unhurried, and
            entirely yours.
          </p>
          <Button asChild className="mt-8">
            <a href={bookingUrl()} target="_blank" rel="noopener noreferrer">
              Start your story <ArrowRight />
            </a>
          </Button>
        </div>

        {/* Collage */}
        <div className="grid grid-cols-[1.5fr_1fr] items-end gap-4">
          <div className="relative aspect-[3/4] overflow-hidden">
            <Image
              src="/images/bride.webp"
              alt="A bride in a reflective moment before the ceremony"
              fill
              sizes="(max-width: 1024px) 45vw, 280px"
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-4">
            <div className="relative aspect-square overflow-hidden">
              <Image
                src="/images/hands.webp"
                alt="Hands intertwined on a wedding day"
                fill
                sizes="(max-width: 1024px) 30vw, 180px"
                className="object-cover"
              />
            </div>
            <p className="rotate-[-3deg] text-xl italic text-[#706b63] text-center leading-tight">
              for the real<br />moments.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="bg-secondary/40 py-20 sm:py-24">
        <div className="site-container">
          <div className="mb-14 text-center">
            <p className="eyebrow">What we believe in</p>
            <h2 className="section-heading mt-5">
              Our <span className="italic">values.</span>
            </h2>
          </div>
          <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {values.map((v) => (
              <div key={v.number} className="border-t border-border pt-6">
                <p className="text-3xl text-[#b3aea6]">{v.number}</p>
                <h3 className="mt-4 text-2xl">{v.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {v.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Visual Storytelling */}
      <section className="site-container section-space">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-20">
          {/* Images — three-up */}
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="relative aspect-[3/4] overflow-hidden">
              <Image
                src="/images/prewedding.webp"
                alt="A couple sharing a quiet moment"
                fill
                sizes="(max-width: 1024px) 45vw, 260px"
                className="object-cover"
              />
            </div>
            <div className="flex flex-col gap-3">
              <div className="relative aspect-square overflow-hidden">
                <Image
                  src="/images/couple.webp"
                  alt="An intimate couple portrait"
                  fill
                  sizes="(max-width: 1024px) 45vw, 220px"
                  className="object-cover"
                />
              </div>
              <div className="relative aspect-[4/3] overflow-hidden">
                <Image
                  src="/images/graduation.webp"
                  alt="A graduate at the start of a new chapter"
                  fill
                  sizes="(max-width: 1024px) 45vw, 220px"
                  className="object-cover"
                />
              </div>
            </div>
          </div>

          {/* Copy */}
          <div>
            <p className="eyebrow">Visual storytelling</p>
            <h2 className="section-heading mt-5">
              Every frame
              <br />
              <span className="italic">has a purpose.</span>
            </h2>
            <p className="mt-6 leading-relaxed text-muted-foreground">
              We don&apos;t shoot to fill a memory card. Every image we create
              is considered — the light, the composition, the moment. We look
              for what is true, not what is perfect.
            </p>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Our editing is clean and timeless. No heavy presets, no chasing
              trends. Just honest light and colour that honours the moment as it
              was.
            </p>

            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-8">
              {[
                { stat: "5+", label: "Years of experience" },
                { stat: "200+", label: "Moments captured" },
                { stat: "100%", label: "Client satisfaction" },
              ].map((item) => (
                <div key={item.label}>
                  <p className="text-4xl leading-none">{item.stat}</p>
                  <p className="mt-2 text-xs text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <BookingCta />
    </main>
  );
}
