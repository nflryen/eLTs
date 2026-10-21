import type { Metadata, Viewport } from "next";
/*
 * DM Sans — the documented substitute for Cosmica. Weights 300/400/500/600/700
 * are loaded explicitly because the system uses all five (300 for large quiet
 * display, 700 for section headings). A single-family system means no second
 * face to load, so this replaces both the old Inter and Cormorant imports.
 */
import "@fontsource/dm-sans/300.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "./globals.css";
import { site } from "@/config/site";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: "%s — Elts. Photography" },
  description: site.description,
  openGraph: {
    title: site.title,
    description: site.description,
    type: "website",
    locale: "en_US",
    siteName: site.name,
  },
  twitter: {
    card: "summary",
    title: site.title,
    description: site.description,
  },
};
export const viewport: Viewport = { themeColor: "#f7f7f5" };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <a
          href="#main-content"
          className="fixed top-3 left-3 z-[100] -translate-y-24 bg-primary px-5 py-3 text-primary-foreground focus:translate-y-0"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
