import Link from "next/link";
import { ArrowUpRight, Camera, Mail } from "lucide-react";
import { bookingUrl, navigation, site } from "@/config/site";

/*
 * Awesomic footer: a dark graphite band that closes the light canvas.
 *
 * The reference alternates light sections with inverted dark blocks; the footer
 * is the natural place for that final contrast, and it keeps the quiet zinc
 * palette rather than introducing a new surface colour.
 */
export function Footer() {
  return (
    <footer className="mt-[var(--section-gap)] bg-[var(--color-graphite)] text-white">
      <div className="site-container py-16">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_0.8fr]">
          <div>
            <Link
              href="/"
              className="text-2xl font-bold tracking-[-0.03em] text-white"
              aria-label="Elts. home"
            >
              Elts.
            </Link>
            <p className="mt-3 max-w-xs text-[14px] leading-[1.45] text-[var(--color-ash)]">
              Photography for real moments. Weddings, graduations, events and
              broadcast across Indonesia.
            </p>
          </div>

          <nav aria-label="Footer navigation" className="flex flex-col gap-3">
            {navigation.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="w-fit text-[14px] text-[var(--color-ash)] transition-colors hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col gap-3">
            {site.instagramUrl && (
              <a
                href={site.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-2 text-[14px] text-[var(--color-ash)] transition-colors hover:text-white"
              >
                <Camera size={15} /> Instagram
              </a>
            )}
            <a
              href={`mailto:${site.email}`}
              className="inline-flex w-fit items-center gap-2 text-[14px] text-[var(--color-ash)] transition-colors hover:text-white"
            >
              <Mail size={15} /> {site.email}
            </a>
            <a
              href={bookingUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-2 text-[14px] text-[var(--color-ash)] transition-colors hover:text-white"
            >
              WhatsApp <ArrowUpRight size={15} />
            </a>
            <Link
              href="/pricelist"
              className="inline-flex w-fit items-center gap-2 text-[14px] text-[var(--color-ash)] transition-colors hover:text-white"
            >
              Pricelist <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>

        <div className="mt-14 flex flex-col justify-between gap-3 border-t border-[var(--color-slate)] pt-6 text-[12px] text-[var(--color-fog)] sm:flex-row">
          <p>© {new Date().getFullYear()} Elts. All rights reserved.</p>
          <p>Studio Purwokerto · Available nationwide</p>
        </div>
      </div>
    </footer>
  );
}
