import type { Metadata } from "next";
import { PortfolioGrid } from "@/components/portfolio/portfolio-grid";
import { BookingCta } from "@/components/home/booking-cta";

export const metadata: Metadata = {
  title: "Portfolio — Stories in Every Frame",
  description:
    "A collection of moments, emotions, and genuine stories captured through our lens. Browse Elts. portfolio by category.",
  alternates: { canonical: "/portfolio" },
};

export default function PortfolioPage() {
  return (
    <main id="main-content">
      {/* Page Header */}
      <section className="site-container pt-20 pb-14">
        <p className="eyebrow">Through our lens</p>
        <h1 className="section-heading mt-5">
          Stories in
          <br />
          <span className="italic">Every Frame.</span>
        </h1>
        <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
          A collection of moments, emotions, and genuine stories captured
          through our lens.
        </p>
      </section>

      {/* Gallery */}
      <section className="site-container pb-24" aria-label="Portfolio gallery">
        <PortfolioGrid />
      </section>

      <BookingCta />
    </main>
  );
}
