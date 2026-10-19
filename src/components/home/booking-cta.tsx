import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingUrl } from "@/config/site";

export function BookingCta() {
  return (
    <section
      id="contact"
      className="relative isolate overflow-hidden text-white"
    >
      <Image
        src="/images/hillside.webp"
        alt="A newly married couple walking together across an open hillside"
        fill
        sizes="100vw"
        className="object-cover object-[center_58%]"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/45 to-black/15" />
      <div className="site-container relative py-20 sm:py-24">
        <p className="eyebrow text-white/75!">Every story starts somewhere</p>
        <h2 className="section-heading mt-6">
          Let’s Create
          <br />
          <span className="italic">Something Beautiful.</span>
        </h2>
        <p className="mt-5 max-w-sm leading-relaxed text-white/80">
          Ready to turn your moments into timeless memories? We’d love to be
          part of your story.
        </p>
        <Button asChild variant="light" className="mt-8">
          <a href={bookingUrl()} target="_blank" rel="noopener noreferrer">
            Book via WhatsApp <ArrowUpRight />
          </a>
        </Button>
      </div>
    </section>
  );
}
