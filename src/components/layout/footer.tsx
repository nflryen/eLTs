import Link from "next/link";
import { ArrowUpRight, Camera } from "lucide-react";
import { bookingUrl, navigation, site } from "@/config/site";

export function Footer() {
  return (
    <footer className="site-container pt-14 pb-7">
      <div className="grid gap-10 border-b border-border pb-12 md:grid-cols-[1fr_1.2fr_0.6fr]">
        <div>
          <Link href="/" className="wordmark" aria-label="Elts. home">
            Elts.
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">
            Photography for real moments.
          </p>
        </div>
        <div className="md:pt-3">
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap gap-x-6 gap-y-3"
          >
            {navigation.map((item) => (
              <Link key={item.label} className="nav-link" href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-6 flex gap-6 text-sm">
            {site.instagramUrl && (
              <a
                href={site.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2"
              >
                <Camera size={15} /> Instagram
              </a>
            )}
            <a
              href={bookingUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2"
            >
              WhatsApp <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
        <p className="font-serif text-3xl leading-[.95] text-[#aaa69e] md:justify-self-end">
          Capture.
          <br />
          Preserve.
          <br />
          <span className="italic">Belong.</span>
        </p>
      </div>
      <div className="mt-6 flex flex-col justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
        <p>© {new Date().getFullYear()} Elts. All rights reserved.</p>
        <p>Preview imagery · Original Elts. portfolio coming soon.</p>
      </div>
    </footer>
  );
}
