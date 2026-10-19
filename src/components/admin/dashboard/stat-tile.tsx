"use client";

import Link from "next/link";
import { ArrowUpRight, Minus } from "lucide-react";
import type { Metric } from "@/lib/dashboard/metric";

/**
 * Awesomic Editorial Zinc Grid — StatTile.
 *
 * Design rules enforced here, not left to each caller:
 *   - surface `#ffffff` on canvas `#f4f4f5`, 1px hairline `#ececee`, 36px radius
 *   - the single accent `#ff5a00` is reserved for ATTENTION only. It never
 *     decorates a healthy number, so when orange appears it means something.
 *   - an unmeasured metric renders "—", never "0". A confident zero on a broken
 *     query is a lie the operator would act on.
 */

export type StatTileAccent = "none" | "attention";

const SPARK_LABELS = {
  ok: "",
  empty: "",
  error: "Tidak dapat diukur",
  hidden: "Terbatas",
} as const;

function formatValue(value: string | number | null): string {
  if (value === null) return "—";
  return typeof value === "number" ? value.toLocaleString("id-ID") : value;
}

export function StatTile({
  label,
  metric,
  format,
  footnote,
  unit,
  href,
  accent = "none",
  /** Optional 0..1 progress for a ratio tile (e.g. gear out / in custody). */
  ratio,
  ratioLabel,
}: {
  label: string;
  metric: Metric<string | number>;
  format?: (value: string | number) => string;
  footnote?: string;
  unit?: string;
  href?: string;
  accent?: StatTileAccent;
  ratio?: number | null;
  ratioLabel?: string;
}) {
  const measured = metric.state === "ok" || metric.state === "empty";
  /*
   * A measured zero and an unmeasurable metric must not look alike. "0" next to
   * "Shooting Hari Ini" reads as "we checked, nothing today"; an em dash reads
   * as "we could not check". `empty` still carries its true zero, so it is
   * displayed as one — but the footnote says what the zero means.
   */
  const display = !measured
    ? "—"
    : format
      ? format(metric.value)
      : formatValue(metric.value);

  const isAttention = accent === "attention" && measured;

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">
          {label}
        </p>
        {href ? (
          <ArrowUpRight
            size={14}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-[#a1a1aa] transition-colors group-hover:text-[#18181b]"
          />
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        <span
          className={`text-[26px] font-semibold leading-none tracking-tight tabular-nums ${
            isAttention ? "text-[#ff5a00]" : "text-[#09090b]"
          }`}
        >
          {display}
        </span>
        {unit && measured ? (
          <span className="text-xs font-medium text-[#a1a1aa]">{unit}</span>
        ) : null}
      </div>

      {typeof ratio === "number" ? (
        <div className="mt-3">
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-[#f4f4f5]"
            role="img"
            aria-label={ratioLabel ?? `${Math.round(ratio * 100)} persen`}
          >
            <div
              className="h-full rounded-full bg-[#18181b]"
              style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
            />
          </div>
          {ratioLabel ? (
            <p className="mt-1.5 text-[11px] text-[#a1a1aa]">{ratioLabel}</p>
          ) : null}
        </div>
      ) : null}

      {footnote || !measured ? (
        <p className="mt-auto pt-2 text-[11px] leading-relaxed text-[#a1a1aa]">
          {!measured ? SPARK_LABELS[metric.state] : footnote}
        </p>
      ) : null}
    </>
  );

  const className = `group flex h-full min-h-[122px] flex-col rounded-[36px] border border-[#ececee] bg-white p-5 transition-colors ${
    isAttention ? "border-[#ff5a00]/35" : ""
  } ${href ? "hover:border-[#d4d4d8]" : ""}`;

  if (href && measured) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  // Unmeasured tiles are not links: there is nothing to open, and a dead link
  // would look like a working control.
  return <div className={className}>{body}</div>;
}

/** A tile group that states plainly when a whole section is unavailable. */
export function StatTilePlaceholder({ label, note }: { label: string; note: string }) {
  return (
    <div className="flex h-full min-h-[122px] flex-col rounded-[36px] border border-dashed border-[#ececee] bg-white/60 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#71717a]">
        {label}
      </p>
      <div className="mt-3 flex items-center gap-2 text-[#a1a1aa]">
        <Minus size={18} aria-hidden="true" />
        <span className="text-sm">{note}</span>
      </div>
    </div>
  );
}
