import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublishedPortfolioPage } from "@/app/actions/portfolio";
import { CanvasRenderer } from "@/components/public/portfolio/canvas-renderer";
import { BookingCta } from "@/components/home/booking-cta";
import { normaliseLayout } from "@/lib/portfolio/layout";

interface Props {
  params: Promise<{ slug: string }>;
}

/*
 * FORCE DYNAMIC — the page is per-slug and reads the published row on every
 * request. Without this, Next.js would prerender only the slugs it can enumerate
 * at build time (none — there is no `generateStaticParams`), and a page published
 * from the CMS afterwards would 404 until the next deploy. Publishing from the
 * admin must take effect immediately, so nothing here is cached.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublishedPortfolioPage(slug).catch(() => null);

  /*
   * A draft or unknown slug must not leak its existence through the <head>, so
   * the fallback is deliberately indistinguishable from a page that does not
   * exist. `robots` is not set to noindex on the found branch: a published
   * showcase is marketing content and SHOULD be indexed.
   */
  if (!bundle) return { title: "Portfolio — Elts." };

  const { page } = bundle;
  return {
    title: page.seo_title ?? `${page.title} — Elts.`,
    description: page.seo_description ?? page.summary ?? undefined,
    alternates: { canonical: `/portfolio/${page.slug}` },
    openGraph: page.cover_url
      ? { title: page.seo_title ?? page.title, images: [page.cover_url] }
      : undefined,
  };
}

export default async function PortfolioShowcasePage({ params }: Props) {
  const { slug } = await params;

  /*
   * `getPublishedPortfolioPage` returns null for a draft. Turning that into
   * `notFound()` rather than an empty page is the whole draft gate: an
   * unpublished page must be indistinguishable from one that was never created.
   */
  const bundle = await getPublishedPortfolioPage(slug);
  if (!bundle) notFound();

  const { page, sections } = bundle;

  return (
    <main id="main-content">
      <section className="site-container pt-20 pb-10">
        <p className="eyebrow">Portfolio</p>
        <h1 className="section-heading mt-5">{page.title}</h1>
        {page.summary ? (
          <p className="mt-6 max-w-lg leading-relaxed text-muted-foreground">{page.summary}</p>
        ) : null}
      </section>

      <section className="site-container space-y-16 pb-24" aria-label={page.title}>
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This page has no sections yet.
          </p>
        ) : (
          sections.map((section) => (
            /*
             * `normaliseLayout` again, at the render boundary. The database
             * trigger validates on write, but a row can also arrive from an older
             * schema or a hand-edited JSONB column — and a public page that loses
             * one malformed block is far better than one that 500s.
             */
            <CanvasRenderer key={section.id} layout={normaliseLayout(section.layout)} />
          ))
        )}
      </section>

      <BookingCta />
    </main>
  );
}
