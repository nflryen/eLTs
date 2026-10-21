import Image from "next/image";
import type { Metadata } from "next";
import { MapPin, MessageCircle } from "lucide-react";
import { ContactForm } from "@/components/contact/contact-form";
import { site, bookingUrl } from "@/config/site";

export const metadata: Metadata = {
  title: "Contact — Let's Tell Your Story",
  description:
    "Ready to book a photography session? Send an inquiry and let's start creating something beautiful together.",
  alternates: { canonical: "/contact" },
};

interface Props {
  /*
   * The pricelist configurator links here with the package and add-ons the
   * client picked, so the inquiry row carries its commercial context instead of
   * arriving as an anonymous "tell us what you need".
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ContactPage({ searchParams }: Props) {
  const params = await searchParams;
  const first = (key: string): string =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  const prefill = {
    packageId: first("package_id"),
    packageName: first("package_name"),
    addons: first("addons"),
  };

  return (
    <main id="main-content">
      <div className="site-container grid gap-16 pb-24 pt-20 lg:grid-cols-[1fr_1.2fr] lg:items-start lg:gap-24">

        {/* Left column — copy + details */}
        <div>
          <p className="eyebrow">Get in touch</p>
          <h1 className="section-heading mt-5">
            Let&apos;s Tell
            <br />
            <span className="italic">Your Story.</span>
          </h1>
          <p className="mt-6 leading-relaxed text-muted-foreground">
            Whether you have a date in mind or you&apos;re just exploring the
            idea, we&apos;d love to hear from you. Fill in the form and
            we&apos;ll follow up on WhatsApp.
          </p>

          {/* Contact details */}
          <div className="mt-10 space-y-5">
            <a
              href={bookingUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-4"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <MessageCircle size={18} />
              </span>
              <div>
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="mt-0.5 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                  +{site.whatsappNumber}
                </p>
              </div>
            </a>
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary">
                <MapPin size={18} />
              </span>
              <div>
                <p className="text-sm font-medium">Based in</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Indonesia · Available nationwide
                </p>
              </div>
            </div>
          </div>

          {/* Photo */}
          <div className="relative mt-12 aspect-[4/3] overflow-hidden hidden lg:block">
            <Image
              src="/images/hillside.webp"
              alt="A beautiful moment captured by Elts. Photography"
              fill
              sizes="(max-width: 1280px) 40vw, 500px"
              className="object-cover object-[center_55%]"
            />
          </div>
        </div>

        {/* Right column — form */}
        <div className="border border-border bg-white p-8 sm:p-10 lg:sticky lg:top-32">
          <h2 className="font-serif text-3xl">Send an Inquiry</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Usually responds within 24 hours.
          </p>
          <div className="mt-8">
            <ContactForm prefill={prefill} />
          </div>
        </div>
      </div>
    </main>
  );
}
