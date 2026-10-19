import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { services } from "@/content/photography";
import { bookingUrl } from "@/config/site";
import { SectionTitle } from "@/components/shared/section-title";

export function Services() {
  return (
    <section id="services" className="bg-secondary/45 py-20 sm:py-24">
      <div className="site-container">
        <div className="text-center">
          <SectionTitle eyebrow="Made for your moments">
            Our <span className="italic">Services.</span>
          </SectionTitle>
          <p className="mt-4 text-muted-foreground">
            Every chapter deserves to be remembered.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-2 gap-x-5 gap-y-9 md:grid-cols-3 lg:grid-cols-5">
          {services.map((service, index) => (
            <a
              key={service.id}
              href={bookingUrl(service.title)}
              target="_blank"
              rel="noopener noreferrer"
              className="group service-card"
              aria-label={`Inquire about ${service.title} photography on WhatsApp`}
            >
              <div className="relative aspect-[.88] overflow-hidden rounded-[2px]">
                <Image
                  src={service.image}
                  alt={service.alt}
                  fill
                  sizes="(max-width: 768px) 45vw, (max-width: 1024px) 30vw, 230px"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <span className="absolute top-3 left-3 text-xs text-white [text-shadow:0_1px_4px_#000]">
                  0{index + 1}
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between">
                <h3 className="font-serif text-2xl">{service.title}</h3>
                <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {service.description}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
