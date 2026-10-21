import type { Metadata } from "next";
import { PortfolioGrid } from "@/components/portfolio/portfolio-grid";
import { ShowcaseFilter } from "@/components/public/portfolio/showcase-filter";
import { BookingCta } from "@/components/home/booking-cta";
import { listPublishedPortfolioPages } from "@/app/actions/portfolio";

/*
 * Published CMS showcases are read per request, so a page published from the
 * admin appears here without a deploy — same reasoning as the detail route.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio — Stories in Every Frame",
  description:
    "A collection of moments, emotions, and genuine stories captured through our lens. Browse Elts. portfolio by category.",
  alternates: { canonical: "/portfolio" },
};

export default async function PortfolioPage() {
  /*
   * A failed read must not take down the static gallery below it, so this
   * degrades to "no showcases" rather than throwing. The gallery is the page's
   * primary content and never depends on the CMS.
   */
  const showcases = await listPublishedPortfolioPages().catch(() => []);

  return (
    <main id="main-content">
      {/* Page Header */}
      <section className="site-container pt-20 pb-14">
        <p className="eyebrow">Through our lens</p>
        <h1 className="mt-5 text-[clamp(40px,5.2vw,64px)] font-semibold leading-[1.12] tracking-[-0.02em] text-[var(--color-obsidian)]">
          Stories in Every Frame.
        </h1>
        <p className="mt-6 max-w-md leading-relaxed text-[var(--color-fog)]">
          A collection of moments, emotions, and genuine stories captured
          through our lens.
        </p>
      </section>

      {/*
       * CMS showcases. The category chips are derived from the published rows,
       * so the filter can never advertise a category with nothing behind it —
       * the whole reason the vocabulary moved out of a hardcoded array.
       */}
      <section className="site-container pb-20" aria-labelledby="showcase-heading">
        <h2 id="showcase-heading" className="eyebrow">
          Kisah pilihan
        </h2>

        {showcases.length === 0 ? (
          /*
           * Honest empty state. The gallery below still renders, so this says
           * "no showcases yet" rather than pretending the page is broken.
           */
          <div className="mt-6 rounded-[var(--radius-cards)] border border-dashed border-[var(--color-cloud)] px-6 py-16 text-center">
            <p className="text-sm font-semibold text-[var(--color-obsidian)]">
              Belum ada kisah yang diterbitkan.
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--color-fog)]">
              Koleksi pilihan sedang disiapkan. Sementara itu, jelajahi galeri di
              bawah.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <ShowcaseFilter pages={showcases} />
          </div>
        )}
      </section>

      {/* Gallery */}
      <section className="site-container pb-24" aria-label="Portfolio gallery">
        <PortfolioGrid />
      </section>

      <BookingCta />
    </main>
  );
}
