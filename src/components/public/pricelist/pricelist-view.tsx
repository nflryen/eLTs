"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, Clock, Info, LayoutGrid, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { idr } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Pricelist, PricelistCategory, PricelistPackage } from "@/lib/pricelist";

/**
 * The public pricelist surface.
 *
 * WHY DATA ARRIVES AS PROPS
 * -------------------------
 * Prices are fetched once on the server and handed down whole. A client fetch
 * would add a spinner between the visitor and the number they came for, and
 * would make the page's price depend on a second round trip that can fail
 * independently of the HTML.
 *
 * WHY A COMPARISON VIEW EXISTS AT ALL
 * -----------------------------------
 * A list of prices answers "how much". It does not answer "which one", which is
 * the actual question a client arrives with. Rendering the packages side by
 * side, and showing only the rows that actually differ, turns four paragraphs
 * of `includes` prose into the one axis the client is deciding on — hours, crew,
 * edited photo count — without making them diff it by eye.
 */

type Props = { data: Pricelist };

type Mode = "cards" | "compare";

/**
 * Rows are candidate axes, not the final table. Each category renders only the
 * rows whose values are not identical across its packages — a row of four
 * dashes teaches the client nothing and pushes the real difference off-screen.
 */
type ComparisonRow = {
  label: string;
  cell: (pkg: PricelistPackage) => string;
};

const DRONE = /drone/i;
const LIVE = /live\s*stream|streaming/i;
const VIDEO = /aftermovie|highlight|teaser|video/i;
const INHERITS = /\ball\b.*\b(package|deliverables)\b/i;
const DASH = "—";
const INHERITED = "Ikut paket induk";

/**
 * Why "Ikut paket induk" exists.
 *
 * Platinum's `includes` says "All Gold Package Deliverables" instead of
 * re-listing them. Rendering that column as dashes would read as "not
 * included" — the exact opposite of what the row means, and on the most
 * expensive package in the list. A deliverable an inheriting package covers is
 * labelled as inherited, so a dash is only ever shown for something genuinely
 * absent.
 *
 * Both columns are scanned: Gold carries "1 Drone Pilot" in `crew` without
 * repeating drone footage in `includes`, and that crew entry is the statement
 * of fact.
 */
function feature(pkg: PricelistPackage, pattern: RegExp): string {
  if ([...pkg.crew, ...pkg.includes].some((item) => pattern.test(item))) {
    return "Termasuk";
  }
  if (pkg.includes.some((item) => INHERITS.test(item))) return INHERITED;
  return DASH;
}

/**
 * Pulls the delivered-photo count out of the free-text `includes` list
 * ("30 Edited Photos" → "30", "120+ Edited Photos" → "120+"). A package that
 * ships the whole gallery reads "Full" rather than a fabricated number.
 */
function editedPhotos(includes: string[]): string {
  const line = includes.find((item) => /edited/i.test(item));
  if (!line) return includes.some((item) => INHERITS.test(item)) ? INHERITED : DASH;
  const match = /^\s*(\d+\+?)/.exec(line);
  return match ? match[1] : "Full";
}

/** Camera count from "2 Cameras Full HD…" — the axis broadcast packages differ on. */
function cameraCount(includes: string[]): string {
  const line = includes.find((item) => /camera/i.test(item));
  if (!line) return includes.some((item) => INHERITS.test(item)) ? INHERITED : DASH;
  const match = /^\s*(\d+)/.exec(line);
  return match ? match[1] : "1";
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "Harga", cell: (pkg) => idr(pkg.priceIdr) },
  /* `duration` is null on the customisable event packages: "Fleksibel" is the
     honest reading of an absent duration, not a blank cell. */
  { label: "Durasi", cell: (pkg) => pkg.duration ?? "Fleksibel" },
  { label: "Maks. orang", cell: (pkg) => (pkg.maxPersons ? `${pkg.maxPersons}` : DASH) },
  /*
   * `crew` holds role descriptions, not people: "2 Photographers (Main &
   * Candid)" is ONE entry covering two people, and Platinum's "Gold Package
   * Team (6 Crew)" is one entry covering six. Counting entries would render
   * Platinum — the largest package — as the smallest team, so the composition
   * is shown verbatim rather than reduced to a number the data cannot support.
   */
  { label: "Kru", cell: (pkg) => (pkg.crew.length ? pkg.crew.join(" · ") : DASH) },
  { label: "Foto diedit", cell: (pkg) => editedPhotos(pkg.includes) },
  { label: "Kamera", cell: (pkg) => cameraCount(pkg.includes) },
  { label: "Drone", cell: (pkg) => feature(pkg, DRONE) },
  { label: "Live streaming", cell: (pkg) => feature(pkg, LIVE) },
  { label: "Video sinematik", cell: (pkg) => feature(pkg, VIDEO) },
  { label: "Catatan", cell: (pkg) => pkg.notes ?? DASH },
];

export function PricelistView({ data }: Props) {
  const [activeSlug, setActiveSlug] = useState(data.categories[0]?.slug ?? "");
  const [mode, setMode] = useState<Mode>("cards");

  /*
   * Selection is held as an id, and the "current" package is DERIVED with a
   * fallback to the first package of the active category. That keeps the
   * configurator populated when the visitor switches tabs (no effect, no
   * render pass where the total is 0) and means a stale id can never point at
   * a package the visitor is no longer looking at.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /*
   * Selection and quantity are SEPARATE state, and the quantity is stored as
   * the raw string the visitor typed.
   *
   * Storing a parsed number conflated "unchecked" (0) with "field is being
   * edited" (also parses to 0), so clearing the input to retype it unmounted
   * the input on the spot and the visitor could never enter a new value. Keeping
   * the text means an empty field is a legitimate in-progress state, and
   * `selected` alone decides whether the row counts toward the total.
   */
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [qtyText, setQtyText] = useState<Record<string, string>>({});

  /*
   * The numeric quantity for one add-on. An empty or unparseable field falls
   * back to 1 — the `min` the input advertises — so the running total stays
   * stable mid-edit instead of flickering to zero.
   */
  const qtyOf = (slug: string): number => {
    const parsed = Number.parseInt(qtyText[slug] ?? "", 10);
    if (!Number.isFinite(parsed)) return 1;
    /* 99 is a sanity cap, not a business rule — it stops a paste of 99999 from
       producing a total that reads as a bug. */
    return Math.max(1, Math.min(99, parsed));
  };

  const activeCategory: PricelistCategory | undefined =
    data.categories.find((category) => category.slug === activeSlug) ??
    data.categories[0];

  const packages = activeCategory?.packages ?? [];

  const activePackage: PricelistPackage | undefined =
    packages.find((pkg) => pkg.id === selectedId) ?? packages[0];

  /*
   * Recomputed on render rather than memoised: ten rows over at most four
   * packages is cheaper than the dependency bookkeeping, and `packages` is a
   * fresh array every render anyway (it is derived from the active category).
   */
  const compareRows = COMPARISON_ROWS.filter((row) => {
    const values = new Set(packages.map((pkg) => row.cell(pkg)));
    return values.size > 1;
  });

  const addonsTotal = data.addons.reduce(
    (sum, addon) => sum + (selected[addon.slug] ? qtyOf(addon.slug) * addon.priceIdr : 0),
    0,
  );
  const packagePrice = activePackage?.priceIdr ?? 0;
  const total = packagePrice + addonsTotal;

  /*
   * Also not memoised: the link is rendered once per commit and `URLSearchParams`
   * is a pure string build. Holding it in a memo would add four dependencies to
   * get back a string the render already knows how to make.
   */
  const bookingHref = ((): string => {
    if (!activePackage || !activeCategory) return "/booking";
    const params = new URLSearchParams();
    params.set("package", activePackage.slug);
    /*
     * Package slugs are only unique WITHIN a category ("personal" exists in both
     * graduation-photo and graduation-video), so the category travels with it.
     * Without it the booking form cannot tell which price was quoted.
     */
    params.set("category", activeCategory.slug);
    /*
     * Quantity rides on the slug as `slug:qty`. A parallel `qty=` array would
     * desynchronise the moment one add-on is dropped, silently pricing the
     * wrong unit count.
     */
    const chosen = data.addons.filter((addon) => selected[addon.slug]);
    if (chosen.length > 0) {
      params.set(
        "addons",
        chosen
          .map((addon) => {
            const qty = qtyOf(addon.slug);
            return qty > 1 ? `${addon.slug}:${qty}` : addon.slug;
          })
          .join(","),
      );
    }
    params.set("total", String(total));
    /*
     * The CTA lands on /contact, NOT /booking.
     *
     * /booking schedules a Google Meet slot into `studio_events` and discards
     * the package entirely, so a client who picked Gold + 2 add-ons arrived as
     * an anonymous 15-minute call with no record of what they wanted. /contact
     * writes a real `inquiries` row, and these params carry the package and
     * add-ons into it — so the lead lands in the pipeline with its commercial
     * context attached.
     */
    params.set("package_id", activePackage.id);
    params.set("package_name", activePackage.name);
    return `/contact?${params.toString()}`;
  })();

  const toggleAddon = (slug: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[slug]) delete next[slug];
      else next[slug] = true;
      return next;
    });
  };

  if (!activeCategory) {
    return (
      <div className="rounded-xl border border-dashed border-[#d4d4d8] px-6 py-12 text-center">
        <p className="text-sm font-semibold text-[#18181b]">
          Pricelist sedang tidak dapat ditampilkan
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[#71717a]">
          Daftar harga gagal dimuat. Hubungi kami melalui WhatsApp dan kami
          kirimkan pricelist terbaru secara langsung.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Category tabs ───────────────────────────────────────────────── */}
      <div className="border-b border-[#ececee] pb-6">
        <div
          role="tablist"
          aria-label="Kategori pricelist"
          className="no-scrollbar -mx-1 flex items-center gap-2 overflow-x-auto px-1 py-1"
        >
          {data.categories.map((category) => {
            const isActive = category.slug === activeCategory.slug;
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                id={`pricelist-tab-${category.slug}`}
                aria-selected={isActive}
                aria-controls="pricelist-panel"
                onClick={() => setActiveSlug(category.slug)}
                className={cn(
                  "shrink-0 rounded-[var(--radius-badges)] border px-4 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-[#18181b] bg-[#18181b] text-white"
                    : "border-[#ececee] bg-white text-[#3f3f46] hover:bg-[#fafafa]",
                )}
              >
                {category.name}
                <span
                  className={cn(
                    "ml-2 text-[11px] tabular-nums",
                    isActive ? "text-white/60" : "text-[#a1a1aa]",
                  )}
                >
                  {category.packages.length}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <p className="max-w-lg text-sm leading-relaxed text-[#71717a]">
            {activeCategory.description ??
              "Pilih paket yang paling dekat dengan kebutuhan Anda."}
          </p>

          {/* View toggle — the card list answers "how much", the table answers
              "which one". Both are one click away rather than a scroll apart. */}
          <div
            role="group"
            aria-label="Tampilan"
            className="flex items-center gap-1 rounded-[var(--radius-badges)] border border-[#ececee] bg-white p-1"
          >
            <button
              type="button"
              onClick={() => setMode("cards")}
              aria-pressed={mode === "cards"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "cards"
                  ? "bg-[#f4f4f5] text-[#18181b]"
                  : "text-[#71717a] hover:text-[#18181b]",
              )}
            >
              <LayoutGrid size={14} /> Kartu
            </button>
            <button
              type="button"
              onClick={() => setMode("compare")}
              aria-pressed={mode === "compare"}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "compare"
                  ? "bg-[#f4f4f5] text-[#18181b]"
                  : "text-[#71717a] hover:text-[#18181b]",
              )}
            >
              <Table2 size={14} /> Bandingkan
            </button>
          </div>
        </div>
      </div>

      <div
        id="pricelist-panel"
        role="tabpanel"
        aria-labelledby={`pricelist-tab-${activeCategory.slug}`}
        className="mt-8 grid gap-8 lg:grid-cols-12 lg:items-start"
      >
        {/* ── Packages ──────────────────────────────────────────────────── */}
        {/*
          `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`,
          so the comparison table's 560px min-width would stretch this column
          past the viewport and scroll the whole PAGE sideways on a phone
          instead of scrolling inside the table's own `overflow-x` container.
        */}
        <div className="min-w-0 lg:col-span-8">
          {mode === "cards" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {packages.map((pkg) => {
                const isSelected = pkg.id === activePackage?.id;
                return (
                  <article
                    key={pkg.id}
                    className={cn(
                      "flex flex-col rounded-[var(--radius-cards)] border bg-white p-[var(--card-padding)] transition-colors",
                      isSelected
                        ? "border-[#18181b] ring-1 ring-[#18181b]"
                        : "border-[#ececee]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-semibold text-[#18181b]">
                        {pkg.name}
                      </h3>
                      {pkg.badge ? (
                        <span className="shrink-0 rounded border border-[#ececee] bg-[#fafafa] px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-[#52525b] uppercase">
                          {pkg.badge}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-xl font-semibold tabular-nums text-[#18181b]">
                      {idr(pkg.priceIdr)}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#71717a]">
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {pkg.duration ?? "Durasi fleksibel"}
                      </span>
                      {pkg.maxPersons ? (
                        <span>Maks. {pkg.maxPersons} orang</span>
                      ) : null}
                    </div>

                    {pkg.crew.length > 0 ? (
                      <p className="mt-3 rounded-lg bg-[#fafafa] px-2.5 py-2 text-[11px] leading-relaxed text-[#52525b]">
                        <span className="font-medium text-[#18181b]">Kru:</span>{" "}
                        {pkg.crew.join(" · ")}
                      </p>
                    ) : null}

                    <ul className="mt-4 flex-1 space-y-1.5">
                      {pkg.includes.map((item) => (
                        <li
                          key={item}
                          className="flex items-start gap-2 text-[12px] leading-relaxed text-[#3f3f46]"
                        >
                          <Check
                            size={13}
                            className="mt-0.5 shrink-0 text-[#18181b]"
                          />
                          {item}
                        </li>
                      ))}
                    </ul>

                    {pkg.notes ? (
                      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-[#a1a1aa]">
                        <Info size={12} className="mt-0.5 shrink-0" />
                        {pkg.notes}
                      </p>
                    ) : null}

                    <Button
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedId(pkg.id)}
                      className="mt-4 w-full"
                    >
                      {isSelected ? "Dipilih" : "Pilih paket ini"}
                    </Button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div>
              {packages.length < 2 ? (
                <p className="rounded-xl border border-dashed border-[#d4d4d8] px-6 py-8 text-center text-xs text-[#71717a]">
                  Kategori ini hanya memiliki satu paket, jadi tidak ada yang
                  bisa dibandingkan.
                </p>
              ) : (
                <div className="no-scrollbar overflow-x-auto rounded-xl border border-[#ececee] bg-white">
                  <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-[#ececee] bg-[#fafafa]">
                        <th className="w-36 px-4 py-3 text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                          Paket
                        </th>
                        {packages.map((pkg) => (
                          <th
                            key={pkg.id}
                            scope="col"
                            className={cn(
                              "px-4 py-3 align-bottom text-xs font-semibold text-[#18181b]",
                              pkg.id === activePackage?.id && "bg-[#f4f4f5]",
                            )}
                          >
                            {pkg.name}
                            {pkg.badge ? (
                              <span className="mt-1 block text-[10px] font-medium tracking-wide text-[#a1a1aa] uppercase">
                                {pkg.badge}
                              </span>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f4f4f5]">
                      {compareRows.map((row) => (
                        <tr key={row.label}>
                          <th
                            scope="row"
                            className="px-4 py-3 text-[11px] font-medium tracking-wide text-[#71717a] uppercase"
                          >
                            {row.label}
                          </th>
                          {packages.map((pkg) => (
                            <td
                              key={pkg.id}
                              className={cn(
                                "px-4 py-3 text-[12px] text-[#3f3f46]",
                                row.label === "Harga" &&
                                  "font-semibold tabular-nums text-[#18181b]",
                                pkg.id === activePackage?.id && "bg-[#fafafa]",
                              )}
                            >
                              {row.cell(pkg)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <tr>
                        <th scope="row" className="px-4 py-3">
                          <span className="sr-only">Pilih paket</span>
                        </th>
                        {packages.map((pkg) => {
                          const isSelected = pkg.id === activePackage?.id;
                          return (
                            <td
                              key={pkg.id}
                              className={cn(
                                "px-4 py-3",
                                isSelected && "bg-[#fafafa]",
                              )}
                            >
                              <Button
                                type="button"
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                aria-pressed={isSelected}
                                onClick={() => setSelectedId(pkg.id)}
                              >
                                {isSelected ? "Dipilih" : "Pilih"}
                              </Button>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-[11px] text-[#a1a1aa]">
                Hanya baris yang berbeda antar paket yang ditampilkan.
              </p>
            </div>
          )}
        </div>

        {/* ── Add-on configurator ───────────────────────────────────────── */}
        <aside
          id="ringkasan"
          className="lg:col-span-4 lg:sticky lg:top-28"
          aria-label="Ringkasan pesanan"
        >
          <div className="rounded-xl border border-[#ececee] bg-white p-5">
            <h2 className="text-sm font-semibold text-[#18181b]">
              Atur pesanan Anda
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-[#71717a]">
              Tambahkan add-on dan lihat totalnya langsung sebelum mengirim
              permintaan.
            </p>

            <div className="mt-4 rounded-lg border border-[#ececee] bg-[#fafafa] px-3 py-2.5">
              <p className="text-[10px] font-medium tracking-wide text-[#71717a] uppercase">
                Paket dipilih
              </p>
              <p className="mt-0.5 text-sm font-medium text-[#18181b]">
                {activePackage?.name ?? "—"}
              </p>
              <p className="text-[11px] text-[#71717a]">
                {activeCategory.name}
                {activePackage?.duration ? ` · ${activePackage.duration}` : ""}
              </p>
            </div>

            <fieldset className="mt-4">
              <legend className="text-[10px] font-medium tracking-wide text-[#71717a] uppercase">
                Add-on
              </legend>
              <ul className="mt-2 divide-y divide-[#f4f4f5]">
                {data.addons.map((addon) => {
                  const checked = Boolean(selected[addon.slug]);
                  const qty = qtyOf(addon.slug);
                  /* Any add-on with a unit is priced per unit, so it gets a
                     quantity input instead of a flat checkbox price. Driven by
                     the `unit` column rather than a hardcoded overtime slug so a
                     new per-unit add-on works the day it is seeded. */
                  const perUnit = Boolean(addon.unit);
                  return (
                    <li key={addon.id} className="py-2.5">
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAddon(addon.slug)}
                          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-[#d4d4d8] accent-[#18181b]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-[12px] font-medium text-[#18181b]">
                              {addon.name}
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-[#3f3f46]">
                              {idr(addon.priceIdr)}
                              {perUnit ? (
                                <span className="text-[#a1a1aa]">
                                  {" "}
                                  / {addon.unit}
                                </span>
                              ) : null}
                            </span>
                          </span>
                          {addon.description ? (
                            <span className="mt-0.5 block text-[11px] leading-relaxed text-[#a1a1aa]">
                              {addon.description}
                            </span>
                          ) : null}
                        </span>
                      </label>

                      {perUnit && checked ? (
                        <div className="mt-2 flex items-center gap-2 pl-6.5">
                          <label
                            htmlFor={`qty-${addon.slug}`}
                            className="text-[11px] text-[#71717a]"
                          >
                            Jumlah ({addon.unit})
                          </label>
                          <input
                            id={`qty-${addon.slug}`}
                            type="number"
                            min={1}
                            max={99}
                            inputMode="numeric"
                            value={qtyText[addon.slug] ?? String(qty)}
                            onChange={(event) =>
                              setQtyText((prev) => ({
                                ...prev,
                                [addon.slug]: event.target.value,
                              }))
                            }
                            className="h-8 w-16 rounded-lg border border-[#ececee] bg-white px-2 text-center text-[12px] tabular-nums text-[#18181b] focus-visible:ring-2 focus-visible:ring-[#3f3f46] focus-visible:outline-none"
                          />
                          <span className="text-[11px] tabular-nums text-[#3f3f46]">
                            {idr(qty * addon.priceIdr)}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <dl className="mt-4 space-y-1.5 border-t border-[#ececee] pt-4 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Paket</dt>
                <dd className="tabular-nums text-[#3f3f46]">{idr(packagePrice)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#71717a]">Add-on</dt>
                <dd className="tabular-nums text-[#3f3f46]">{idr(addonsTotal)}</dd>
              </div>
              <div
                aria-live="polite"
                className="mt-2 flex items-baseline justify-between gap-2 border-t border-[#ececee] pt-2"
              >
                <dt className="text-[11px] font-medium tracking-wide text-[#71717a] uppercase">
                  Total estimasi
                </dt>
                <dd className="text-lg font-semibold tabular-nums text-[#18181b]">
                  {idr(total)}
                </dd>
              </div>
            </dl>

            <Button asChild className="mt-4 w-full">
              <Link href={bookingHref}>
                Pesan paket ini <ArrowRight />
              </Link>
            </Button>
            <p className="mt-2 text-[10px] leading-relaxed text-[#a1a1aa]">
              Total estimasi belum termasuk penyesuaian kebutuhan khusus. Tim
              kami mengonfirmasi harga final saat konsultasi.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
