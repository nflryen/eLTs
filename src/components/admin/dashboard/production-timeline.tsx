"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Clock, Package } from "lucide-react";
import type { AttentionQueue } from "@/types/attention";
import type { Metric } from "@/lib/dashboard/metric";
import type { TimelineEntry } from "@/lib/dashboard/types";

/**
 * Production timeline + attention drawer.
 *
 * Two different questions, two different shapes:
 *
 *   Timeline — "what happens today, in what order?" A vertical rail, because
 *   order IS the information. The next unstarted entry is marked so the
 *   operator's eye lands on what is imminent without reading every row.
 *
 *   Attention — "what is broken?" Previously this was the whole landing page,
 *   which made a clean day look like an empty page and a busy day look
 *   catastrophic. It is now a collapsed strip that states the count and expands
 *   on demand, so the dashboard leads with facts and surfaces risk on request.
 */

function RailDot({ next, kind }: { next: boolean; kind: TimelineEntry["kind"] }) {
  if (next) {
    return (
      <span
        aria-hidden="true"
        className="absolute -left-[5px] top-1.5 size-2.5 rounded-full bg-[#ff5a00] ring-4 ring-[#ff5a00]/15"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`absolute -left-[4px] top-1.5 size-2 rounded-full border-2 bg-white ${
        kind === "shoot" ? "border-[#18181b]" : "border-[#a1a1aa]"
      }`}
    />
  );
}

export function ProductionTimeline({ timeline }: { timeline: Metric<TimelineEntry[]> }) {
  const measured = timeline.state === "ok" || timeline.state === "empty";
  const entries = measured ? timeline.value : [];

  return (
    <section
      aria-label="Linimasa produksi hari ini"
      className="rounded-[36px] border border-[#ececee] bg-white p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-[#09090b]">
          Linimasa Produksi
        </h2>
        <span className="text-[11px] uppercase tracking-[0.14em] text-[#a1a1aa]">Hari ini</span>
      </div>

      {!measured ? (
        <p className="mt-6 text-sm text-[#a1a1aa]">
          Linimasa tidak dapat dimuat. Muat ulang untuk mencoba lagi.
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-6 text-sm text-[#71717a]">
          Tidak ada pengambilan atau serah-terima terjadwal hari ini.
        </p>
      ) : (
        <ol className="relative mt-5 space-y-5 border-l border-[#ececee] pl-5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <RailDot next={entry.next} kind={entry.kind} />
              <div className="flex items-baseline gap-2.5">
                <span className="shrink-0 font-mono text-xs text-[#71717a]">
                  {entry.time ?? "--:--"}
                </span>
                {entry.kind === "handoff" ? (
                  <Package size={12} aria-hidden="true" className="shrink-0 text-[#a1a1aa]" />
                ) : (
                  <Clock size={12} aria-hidden="true" className="shrink-0 text-[#a1a1aa]" />
                )}
                <Link
                  href={entry.href}
                  className="truncate text-sm font-medium text-[#18181b] underline-offset-4 hover:underline"
                >
                  {entry.title}
                </Link>
                {entry.next ? (
                  <span className="shrink-0 rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#c2410c]">
                    Berikutnya
                  </span>
                ) : null}
              </div>
              <p className="mt-1 pl-[52px] text-xs text-[#71717a]">{entry.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AttentionDrawer({ queue }: { queue: AttentionQueue }) {
  const [open, setOpen] = useState(false);
  const { summary, items } = queue;

  // Only the accent-bearing severities are worth a coloured strip.
  const needsAttention = summary.critical > 0;

  return (
    <section
      aria-label="Perlu perhatian"
      className="rounded-[36px] border border-[#ececee] bg-white"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="attention-drawer-body"
        className="flex min-h-11 w-full items-center justify-between gap-3 overflow-hidden rounded-t-[36px] px-5 py-4 text-left transition-colors hover:bg-[#fafafa]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <AlertTriangle
            size={15}
            aria-hidden="true"
            className={needsAttention ? "text-[#ff5a00]" : "text-[#a1a1aa]"}
          />
          <span className="truncate text-sm font-semibold text-[#09090b]">Perlu Perhatian</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
              needsAttention
                ? "bg-[#ff5a00]/10 text-[#c2410c]"
                : "bg-[#f4f4f5] text-[#52525b]"
            }`}
          >
            {summary.total}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-[#a1a1aa] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div id="attention-drawer-body" className="border-t border-[#ececee] px-5 py-4">
          {items.length === 0 ? (
            <p className="text-sm text-[#71717a]">
              Tidak ada yang menunggu tindakan. Semua bersih.
            </p>
          ) : (
            <ul className="divide-y divide-[#f4f4f5]">
              {items.map((item) => {
                const primary = item.actions[0];
                return (
                  <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                        item.severity === "critical"
                          ? "bg-[#ff5a00]"
                          : item.severity === "high"
                            ? "bg-[#18181b]"
                            : "bg-[#a1a1aa]"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-[#18181b]">{item.title}</p>
                      <p className="mt-0.5 text-xs text-[#71717a]">{item.detail}</p>
                    </div>
                    {primary ? (
                      <Link
                        href={primary.href}
                        target={primary.href.startsWith("http") ? "_blank" : undefined}
                        rel={primary.href.startsWith("http") ? "noopener noreferrer" : undefined}
                        className="shrink-0 rounded-full border border-[#ececee] px-3 py-1.5 text-xs font-semibold text-[#3f3f46] transition-colors hover:bg-[#fafafa]"
                      >
                        {primary.label}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
