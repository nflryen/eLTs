import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { services } from "@/content/photography";

/*
 * Awesomic category band.
 *
 * Each card is a SNOW surface with a 36px radius and a 1px CLOUD hairline — no
 * drop shadow. The image is flush to the top edges of the rounded card, and the
 * lower section carries 28px padding, a 20px/600 title, and hairline tag pills.
 * This is the reference's "Category Card (Image Top)" component, which is also
 * why the section no longer needs a tinted background: the cards themselves
 * provide the structure against the PAPER canvas.
 */
export function Services() {
  return (
    <section id="services" className="site-container section-space">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Made for your moments</p>
          <h2 className="section-title mt-4">Our services</h2>
        </div>
        <Link
          href="/pricelist"
          className="inline-flex items-center gap-1.5 text-[14px] text-[var(--color-graphite)] transition-colors hover:text-[var(--color-obsidian)]"
        >
          See all pricing <ArrowUpRight size={15} />
        </Link>
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {services.map((service) => (
          <Link
            key={service.id}
            href="/pricelist"
            className="group overflow-hidden rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] transition-colors hover:border-[var(--color-mist)]"
            aria-label={`See pricing for ${service.title}`}
          >
            {/* Image flush to the card edges, top corners only. */}
            <div className="relative aspect-[4/3] overflow-hidden">
              <Image
                src={service.image}
                alt={service.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 380px"
                className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
              />
            </div>
            <div className="p-[var(--card-padding)]">
              <h3 className="text-[20px] font-semibold leading-[1.5] text-[var(--color-obsidian)]">
                {service.title}
              </h3>
              <p className="mt-2 text-[14px] leading-[1.45] text-[var(--color-fog)]">
                {service.description}
              </p>
              <span className="mt-4 inline-flex items-center gap-1 rounded-[var(--radius-badges)] border border-[var(--color-cloud)] px-2 py-1 text-[12px] text-[var(--color-graphite)]">
                Lihat paket <ArrowUpRight size={12} />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
