import Image from "next/image";
import type { Metadata } from "next";
import { ArrowUpRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BookingCta } from "@/components/home/booking-cta";
import { servicesDetail } from "@/content/photography";
import { bookingUrl } from "@/config/site";

export const metadata: Metadata = {
  title: "Services — What We Offer",
  description:
    "Wedding, prewedding, graduation, couple, and event photography. Every session is crafted with intention, authenticity, and care.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <main id="main-content">
      {/* Page Header */}
      <section className="site-container pt-20 pb-16">
        <p className="eyebrow">Made for your moments</p>
        <h1 className="section-heading mt-5">
          Our
          <br />
          <span className="italic">Services.</span>
        </h1>
        <p className="mt-6 max-w-md leading-relaxed text-muted-foreground">
          Every chapter of your life deserves to be remembered. We offer
          photography that feels genuine, unhurried, and entirely yours.
        </p>
      </section>

      {/* Services List */}
      <section className="site-container space-y-0 pb-24" aria-label="Photography services">
        {servicesDetail.map((service, index) => (
          <article
            key={service.id}
            id={service.id}
            className="grid gap-12 border-t border-border py-16 lg:grid-cols-2 lg:items-center lg:gap-20"
          >
            {/* Image — alternates left/right */}
            <div
              className={`relative aspect-[4/3] overflow-hidden lg:aspect-[5/4] ${
                index % 2 === 1 ? "lg:order-2" : ""
              }`}
            >
              <Image
                src={service.image}
                alt={service.alt}
                fill
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
              {/* Service index label */}
              <span className="absolute top-5 left-5 font-serif text-5xl font-light text-white/30 leading-none select-none">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>

            {/* Copy */}
            <div className={index % 2 === 1 ? "lg:order-1" : ""}>
              <p className="eyebrow">{service.subtitle}</p>
              <h2 className="section-heading mt-4">{service.title}</h2>
              <p className="mt-6 leading-relaxed text-muted-foreground">
                {service.description}
              </p>
              <blockquote className="mt-6 border-l-2 border-border pl-4 font-serif text-lg italic text-[#706b63] leading-snug">
                {service.philosophy}
              </blockquote>

              {/* What's included */}
              <div className="mt-8">
                <p className="text-xs font-medium tracking-[.18em] uppercase text-muted-foreground mb-4">
                  What&apos;s included
                </p>
                <ul className="grid grid-cols-2 gap-y-2 gap-x-4">
                  {service.includes.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <Check
                        size={14}
                        className="mt-0.5 shrink-0 text-foreground"
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <Button asChild className="mt-8">
                <a
                  href={bookingUrl(service.whatsappService)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Inquire via WhatsApp <ArrowUpRight />
                </a>
              </Button>
            </div>
          </article>
        ))}
      </section>

      <BookingCta />
    </main>
  );
}
