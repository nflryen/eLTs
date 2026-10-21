"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { PublishedPortfolioPage } from "@/app/actions/portfolio";
import {
  PORTFOLIO_CATEGORIES,
  PORTFOLIO_CATEGORY_LABELS,
  isPortfolioCategory,
  type PortfolioCategory,
} from "@/lib/portfolio/category";

/**
 * Published showcases with a category filter.
 *
 * WHY IN MEMORY AND NOT `?category=`
 * ----------------------------------
 * The index already fetches every published page to count the chips, so the
 * rows are in the payload either way. Filtering in memory makes a chip press
 * instant and keeps the URL clean; a `searchParams` filter would round-trip to
 * the server for data the browser already holds, and would still need this
 * client component to make the chips keyboard-friendly.
 *
 * WHY THE CHIP LIST IS DERIVED
 * ----------------------------
 * A chip is rendered only when at least one published page uses that category.
 * A permanent "Graduation" chip that opens an empty grid is a dead end: the
 * visitor cannot tell "nothing published yet" from "broken". The list therefore
 * comes from the data, never from `PORTFOLIO_CATEGORIES` alone.
 */

type Filter = "all" | PortfolioCategory;

export function ShowcaseFilter({ pages }: { pages: PublishedPortfolioPage[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  /*
   * Categories present in the DATA, in the canonical vocabulary order so the
   * chips do not reshuffle when a page is published or re-sorted.
   */
  const available = useMemo(() => {
    const present = new Set<string>();
    for (const page of pages) {
      if (isPortfolioCategory(page.category)) present.add(page.category);
    }
    return PORTFOLIO_CATEGORIES.filter((category) => present.has(category));
  }, [pages]);

  /*
   * A category can disappear while a visitor is looking at it — an operator
   * unpublishing the last page of that category makes the active chip vanish.
   * Falling back to "all" keeps the grid from rendering as an empty state with
   * no visible way out.
   */
  const active: Filter =
    filter !== "all" && !available.includes(filter) ? "all" : filter;

  const visible = useMemo(
    () => (active === "all" ? pages : pages.filter((page) => page.category === active)),
    [pages, active],
  );

  const chipClass = (selected: boolean) =>
    `rounded-[var(--radius-badges)] border px-4 py-2 text-[13px] font-medium transition-colors ${
      selected
        ? "border-[var(--color-graphite)] bg-[var(--color-graphite)] text-[var(--color-snow)]"
        : "border-[var(--color-cloud)] bg-[var(--color-snow)] text-[var(--color-graphite)] hover:border-[var(--color-graphite)]"
    }`;

  /*
   * The bar is rendered whenever there are pages, even if only one category is
   * in use: hiding it would make the grid silently narrower than the archive,
   * and a visitor who lands on a filtered URL would have no control to widen it.
   * What is NOT rendered is a chip for a category with zero published pages.
   */
  const uncategorised = pages.filter((page) => !isPortfolioCategory(page.category)).length;

  return (
    <div>
      <div
        role="group"
        aria-label="Filter portfolio by category"
        className="flex flex-wrap items-center gap-2"
      >
        <button
          type="button"
          aria-pressed={active === "all"}
          onClick={() => setFilter("all")}
          className={chipClass(active === "all")}
        >
          Semua
        </button>

        {available.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={active === category}
            onClick={() => setFilter(category)}
            className={chipClass(active === category)}
          >
            {PORTFOLIO_CATEGORY_LABELS[category]}
          </button>
        ))}

        {/*
         * Polite live region: a press changes the grid below, and a screen
         * reader user gets no other signal that the count moved.
         */}
        <span aria-live="polite" className="ml-auto text-xs text-[var(--color-fog)]">
          {visible.length} kisah
        </span>
      </div>

      {/*
       * Pages exist but none is categorised. Saying so beats an "All"-only bar
       * that looks like the filter failed to load, and it tells the operator
       * what is missing without exposing CMS language to a visitor.
       */}
      {available.length === 0 && (
        <p className="mt-4 text-xs text-[var(--color-fog)]">
          {uncategorised} kisah belum memiliki kategori. Semua ditampilkan di bawah.
        </p>
      )}

      <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((page) => (
          <li key={page.id}>
            <Link
              href={`/portfolio/${page.slug}`}
              className="group block overflow-hidden rounded-[var(--radius-cards)] border border-[var(--color-cloud)] bg-[var(--color-snow)] transition-colors hover:border-[var(--color-graphite)]"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-paper)]">
                {page.cover_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={page.cover_url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-[0.18em] text-[var(--color-fog)]">
                    Elts.
                  </div>
                )}
              </div>
              <div className="flex items-start justify-between gap-3 p-5">
                <div>
                  {isPortfolioCategory(page.category) && (
                    <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fog)]">
                      {PORTFOLIO_CATEGORY_LABELS[page.category]}
                    </p>
                  )}
                  <h3 className="mt-1 text-[20px] font-semibold leading-[1.5] text-[var(--color-obsidian)]">
                    {page.title}
                  </h3>
                  {page.summary && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-[var(--color-fog)]">
                      {page.summary}
                    </p>
                  )}
                </div>
                <ArrowUpRight
                  size={16}
                  aria-hidden
                  className="mt-1 shrink-0 text-[var(--color-fog)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
