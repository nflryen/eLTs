import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/*
 * Awesomic hero — editorial split composition.
 *
 * The reference pairs a massive left-aligned display headline with a compact
 * right-hand block, on the PAPER canvas, with no hero image behind the type.
 * The previous version was a full-bleed photograph with a gradient wash, which
 * fights the system's rule that photography is STRUCTURAL (it belongs in the
 * category band and breakthrough sections), not a backdrop for text.
 *
 * The headline keeps weight 600 at 56–64px: the bold weight is what makes the
 * editorial register read as authoritative rather than tentative.
 */
export function Hero() {
  return (
    <section
      id="home"
      className="relative isolate"
      aria-labelledby="hero-title"
    >
      <div className="site-container pt-20 pb-[var(--section-gap)] sm:pt-28">
        <div className="grid items-end gap-12 lg:grid-cols-[1.35fr_0.65fr]">
          <div>
            <p className="eyebrow">Photography for real moments</p>
            <h1
              id="hero-title"
              className="mt-6 text-[clamp(40px,6.4vw,64px)] font-semibold leading-[1.12] tracking-[-0.02em] text-[var(--color-obsidian)]"
            >
              Your story deserves
              <br />
              to be remembered.
            </h1>
          </div>

          <div className="lg:pb-2">
            <p className="max-w-sm text-[15px] leading-[1.45] text-[var(--color-steel)]">
              Weddings, graduations, events and broadcast across Indonesia.
              Transparent pricing, no surprises.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button asChild>
                <Link href="/booking">
                  Book a session <ArrowRight />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/pricelist">
                  See pricing <ArrowUpRight />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
