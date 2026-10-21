import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Awesomic dark feature block — the inverted band that closes the light page.
 *
 * The reference alternates PAPER canvas with a graphite surface rather than
 * layering text over a photograph. A full-bleed image with a gradient wash is
 * explicitly the pattern this system avoids: photography is structural, and a
 * dark block provides the contrast without competing with the type.
 */
export function BookingCta() {
  return (
    <section id="contact" className="site-container section-space">
      <div className="rounded-[var(--radius-cards)] bg-[var(--color-graphite)] px-8 py-16 text-white sm:px-14 sm:py-20">
        <div className="grid items-end gap-10 lg:grid-cols-[1.3fr_0.7fr]">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-[var(--color-ash)]">
              Every story starts somewhere
            </p>
            <h2 className="mt-5 text-[clamp(32px,4.4vw,56px)] font-semibold leading-[1.12] tracking-[-0.02em]">
              Let&apos;s create something beautiful.
            </h2>
          </div>
          <div>
            <p className="max-w-sm text-[15px] leading-[1.45] text-[var(--color-ash)]">
              Ready to turn your moments into timeless memories? We&apos;d love
              to be part of your story.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="light">
                <Link href="/contact">
                  Start an inquiry <ArrowUpRight />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="text-white hover:bg-white/10 hover:text-white"
              >
                <Link href="/booking">Schedule a call</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
