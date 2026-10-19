import type { Metadata } from "next";
import { Hero } from "@/components/home/hero";
import { AboutPreview } from "@/components/home/about-preview";
import { Services } from "@/components/home/services";
import { FeaturedWorks } from "@/components/portfolio/featured-works";
import { BookingCta } from "@/components/home/booking-cta";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default function HomePage() {
  return (
    <main id="main-content">
      <Hero />
      <div className="border-b border-border">
        <div className="site-container flex flex-col items-center justify-between gap-5 py-8 sm:flex-row">
          <p className="text-sm text-muted-foreground">
            Trusted for meaningful moments.
          </p>
          <div className="flex gap-7 font-serif text-xl text-[#817c72] sm:gap-10">
            <span>Real connection.</span>
            <span>Honest stories.</span>
            <span className="hidden italic sm:inline">Lasting memories.</span>
          </div>
        </div>
      </div>
      <AboutPreview />
      <Services />
      <FeaturedWorks />
      <BookingCta />
    </main>
  );
}
