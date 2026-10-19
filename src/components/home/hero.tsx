import Image from "next/image";
import { ArrowDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingUrl } from "@/config/site";

export function Hero() {
  return (
    <section
      id="home"
      className="hero relative isolate overflow-hidden"
      aria-labelledby="hero-title"
    >
      <Image
        src="/images/hero.webp"
        alt="A bride and groom sharing a moment in a sunlit landscape"
        fill
        loading="eager"
        fetchPriority="high"
        sizes="(max-width: 767px) 100vw, 64vw"
        className="hero-image object-cover"
      />
      <div className="hero-shade absolute inset-0" />
      <div className="site-container relative flex h-full items-center">
        <div className="hero-copy max-w-2xl py-20">
          <p className="eyebrow hero-enter">Photography for real moments</p>
          <h1 id="hero-title" className="hero-title hero-enter mt-7">
            Your Story
            <br />
            Deserves to Be
            <br />
            <span className="italic">Remembered.</span>
          </h1>
          <p className="hero-enter mt-7 max-w-80 text-base leading-relaxed text-[#53524e]">
            We capture genuine moments and turn them into timeless memories.
          </p>
          <div className="hero-enter mt-9 flex flex-wrap items-center gap-6">
            <Button asChild>
              <a href={bookingUrl()} target="_blank" rel="noopener noreferrer">
                Book a Session <ArrowRight />
              </a>
            </Button>
            <a
              href="#portfolio"
              className="group flex items-center gap-3 text-sm font-medium"
            >
              View Our Work{" "}
              <span className="flex size-8 items-center justify-center rounded-full border border-[#77766d]/40 transition-transform group-hover:translate-x-1">
                <ArrowRight size={15} />
              </span>
            </a>
          </div>
        </div>
        <div className="hero-aside absolute right-0 bottom-12 hidden text-right lg:block">
          <span className="text-xs tracking-[.24em]">
            01 / A MOMENT, FOREVER
          </span>
          <p className="mt-4 font-serif text-2xl leading-tight">
            Timeless.
            <br />
            Authentic.
            <br />
            <span className="italic">Meaningful.</span>
          </p>
        </div>
        <a
          href="#about"
          aria-label="Discover Elts."
          className="absolute bottom-8 left-0 hidden items-center gap-3 text-xs tracking-[.14em] md:flex"
        >
          <ArrowDown size={15} /> SCROLL TO DISCOVER
        </a>
      </div>
    </section>
  );
}
