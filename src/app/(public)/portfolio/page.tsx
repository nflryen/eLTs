import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { PortfolioGrid } from "@/components/portfolio/portfolio-grid";
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

      {/*
       * CMS showcases render only when at least one page is published. An empty
       * heading over an empty grid would be worse than no section at all.
       */}
      {showcases.length > 0 && (
        <section
          className="site-container pb-20"
          aria-label="Portfolio showcases"
        >
          <h2 className="eyebrow">Kisah pilihan</h2>
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {showcases.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/portfolio/${page.slug}`}
                  className="group block overflow-hidden rounded-sm border border-border/60 transition-colors hover:border-foreground/30"
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                    {page.cover_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={page.cover_url}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Elts.
                      </div>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-3 p-5">
                    <div>
                      <h3 className="font-serif text-xl tracking-tight">
                        {page.title}
                      </h3>
                      {page.summary && (
                        <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                          {page.summary}
                        </p>
                      )}
                    </div>
                    <ArrowUpRight
                      size={16}
                      aria-hidden
                      className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Gallery */}
      <section className="site-container pb-24" aria-label="Portfolio gallery">
        <PortfolioGrid />
      </section>

      <BookingCta />
    </main>
  );
}
