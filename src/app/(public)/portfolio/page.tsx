import type { Metadata } from "next";
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
   * Read dynamic CMS showcases published from the studio admin.
   * Degrades gracefully to an honest empty state if none are published yet.
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
       * CMS showcases. Category chips are derived dynamically from published rows,
       * ensuring only active categories with live stories are displayed.
       */}
      <section className="site-container pb-24" aria-labelledby="showcase-heading">
        <h2 id="showcase-heading" className="eyebrow">
          Selected stories
        </h2>

        {showcases.length === 0 ? (
          <div className="mt-6 rounded-[var(--radius-cards)] border border-dashed border-[var(--color-cloud)] px-6 py-16 text-center">
            <p className="text-sm font-semibold text-[var(--color-obsidian)]">
              No stories published yet.
            </p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--color-fog)]">
              The curated collection is being prepared. Explore our services or contact our team to discuss your project.
            </p>
          </div>
        ) : (
          <div className="mt-6">
            <ShowcaseFilter pages={showcases} />
          </div>
        )}
      </section>

      <BookingCta />
    </main>
  );
}
