import type { Metadata } from "next";
import { PricelistView } from "@/components/public/pricelist/pricelist-view";
import { BookingCta } from "@/components/home/booking-cta";
import { getPricelist } from "@/lib/pricelist";

export const metadata: Metadata = {
  title: "Pricelist — Transparent Pricing",
  description:
    "Official ELTs. Studio Purwokerto pricing for graduation photo & video, event documentation, broadcast live streaming, and wedding & engagement. Compare packages and calculate add-ons instantly.",
  alternates: { canonical: "/pricelist" },
};

/**
 * Prices are read per request rather than baked in at build time.
 *
 * A price change made in the admin has to be the number the next visitor sees.
 * A statically generated price page would keep quoting the old figure until the
 * next deploy — and a client who was quoted last week's price is a dispute, not
 * a cache miss. The read is three indexed selects against a 26-row dataset.
 */
export const dynamic = "force-dynamic";

export default async function PricelistPage() {
  const data = await getPricelist();

  return (
    <main id="main-content">
      <section className="site-container pt-20 pb-12">
        <p className="eyebrow">Transparent pricing, no surprises</p>
        <h1 className="section-heading mt-5">
          Pricelist
          <br />
          <span className="italic">2026.</span>
        </h1>
        <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
          Every package is written plainly: duration, crew count, and exactly
          what you receive. Compare packages side by side, then build your
          add-ons.
        </p>
      </section>

      <section className="site-container pb-24" aria-label="Pricing list">
        <PricelistView data={data} />
      </section>

      <BookingCta />
    </main>
  );
}
