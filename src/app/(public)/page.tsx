import type { Metadata } from "next";
import { Hero } from "@/components/home/hero";
import { AboutPreview } from "@/components/home/about-preview";
import { Services } from "@/components/home/services";
import { FeaturedWorks } from "@/components/portfolio/featured-works";
import { BookingCta } from "@/components/home/booking-cta";
import { getPricelist } from "@/lib/pricelist";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/*
 * Reads the live pricelist so the stats row reports numbers that are actually
 * true. Hardcoding "500+ sessions" would be an invented claim on a page whose
 * whole argument is transparent pricing.
 */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const pricelist = await getPricelist().catch(() => ({ categories: [], addons: [] }));
  const packageCount = pricelist.categories.reduce((n, c) => n + c.packages.length, 0);
  const categoryCount = pricelist.categories.length;
  return (
    <main id="main-content">
      <Hero />
      {/*
        Stats row — Awesomic pattern: large number at 40–56px weight 600 in
        obsidian, descriptor at 14px in steel on the same baseline.
      */}
      <div className="site-container">
        <div className="grid gap-8 border-y border-[var(--color-cloud)] py-10 sm:grid-cols-3">
          {[
            { value: String(categoryCount), label: "Service categories" },
            { value: String(packageCount), label: "Packages published" },
            { value: String(pricelist.addons.length), label: "Add-ons available" },
          ]
            .filter((stat) => stat.value !== "0")
            .map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-3">
              <span className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-[var(--color-obsidian)]">
                {stat.value}
              </span>
              <span className="text-[14px] leading-[1.45] text-[var(--color-steel)]">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
      <AboutPreview />
      <Services />
      <FeaturedWorks />
      <BookingCta />
    </main>
  );
}
