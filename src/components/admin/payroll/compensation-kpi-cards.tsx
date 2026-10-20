"use client";

import { Wallet, TrendingUp, CheckCircle2, Hourglass } from "lucide-react";
import { formatRupiah } from "@/lib/reminders/compose";

/**
 * Role-wide compensation KPI cards.
 *
 * Both values arrive pre-computed from the server. For WORKER and FREELANCER
 * they come from `my_earnings_summary()`, a zero-argument SECURITY DEFINER RPC
 * that scopes itself to `auth.uid()` — this component never receives a user id,
 * and never sums anything itself.
 */

export type CompensationKpi = {
  pendingPayout: number;
  pendingCount: number;
  currentMonthPayout: number;
};

export function CompensationKpiCardsSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-[18px] border border-[#ececee] bg-white p-4">
          {/* Fixed heights prevent layout shift when the real value lands. */}
          <div className="h-2.5 w-24 animate-pulse rounded-full bg-[#f4f4f5]" />
          <div className="mt-3 h-6 w-32 animate-pulse rounded-full bg-[#f4f4f5]" />
          <div className="mt-2 h-2.5 w-40 animate-pulse rounded-full bg-[#fafafa]" />
        </div>
      ))}
    </div>
  );
}

export function CompensationKpiCards({ data }: { data: CompensationKpi }) {
  const hasPending = data.pendingPayout > 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {/* Card 1 — pending payout */}
      <div className="rounded-[18px] border border-[#fcd34d] bg-[#fffbeb] p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#92400e]">
            Gaji Belum Terbayar
          </p>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#92400e]">
            <Hourglass size={9} aria-hidden="true" />
            {hasPending ? "Menunggu" : "Kosong"}
          </span>
        </div>
        <p className="mt-2 font-mono text-xl font-bold tabular-nums tracking-tight text-[#78350f]">
          {formatRupiah(data.pendingPayout)}
        </p>
        <p className="mt-0.5 text-[11px] text-[#92400e]/80">
          {data.pendingCount > 0
            ? `${data.pendingCount} tugas menunggu verifikasi atau pencairan`
            : "Tidak ada pembayaran tertunda"}
        </p>
      </div>

      {/* Card 2 — settled this month */}
      <div className="rounded-[18px] border border-[#a7f3d0] bg-[#ecfdf5] p-4">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#065f46]">
            Gaji Bulan Ini
          </p>
          <CheckCircle2 size={15} className="text-[#059669]" aria-hidden="true" />
        </div>
        <p className="mt-2 font-mono text-xl font-bold tabular-nums tracking-tight text-[#065f46]">
          {formatRupiah(data.currentMonthPayout)}
        </p>
        <p className="mt-0.5 text-[11px] text-[#065f46]/80">
          Dicairkan pada siklus bulan kalender berjalan
        </p>
      </div>
    </div>
  );
}

/** Compact variant for the daily command bar. */
export function CompensationKpiInline({ data }: { data: CompensationKpi }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-[10000px] border border-[#fcd34d] bg-[#fffbeb] px-3 py-1.5">
        <Wallet size={12} className="text-[#b45309]" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#92400e]">Tertunda</span>
        <span className="font-mono text-xs font-bold tabular-nums text-[#78350f]">
          {formatRupiah(data.pendingPayout)}
        </span>
      </span>
      <span className="inline-flex items-center gap-2 rounded-[10000px] border border-[#a7f3d0] bg-[#ecfdf5] px-3 py-1.5">
        <TrendingUp size={12} className="text-[#059669]" aria-hidden="true" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#065f46]">Bulan ini</span>
        <span className="font-mono text-xs font-bold tabular-nums text-[#065f46]">
          {formatRupiah(data.currentMonthPayout)}
        </span>
      </span>
    </div>
  );
}
