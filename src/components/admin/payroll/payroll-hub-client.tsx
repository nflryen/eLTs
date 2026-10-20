"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import {
  Wallet, TrendingUp, PiggyBank, Clock3, ShieldAlert, Download,
  CheckCircle2, FileText, Users, Camera, Briefcase, HandCoins, CalendarClock,
} from "lucide-react";
import {
  advanceLineItemState,
  type PayrollLineItem,
  type PayrollSummary,
  type PayrollTab,
} from "@/app/actions/payroll";
import { formatRupiah } from "@/lib/reminders/compose";

/**
 * Master Payroll Hub.
 *
 * `rank` arrives from the server (the page's guard) and is used ONLY to decide
 * which tabs to render. It is never used to filter data: dividend rows are
 * already absent from the payload for rank < 100, because omitting them at the
 * query is the only way to keep them out of the RSC payload.
 */

const TABS: Array<{ id: PayrollTab; label: string; icon: typeof Users; execOnly?: boolean }> = [
  { id: "all", label: "Semua", icon: Wallet },
  { id: "crew", label: "Kru Freelance", icon: Camera },
  { id: "editor", label: "Editor / Worker", icon: FileText },
  { id: "staff", label: "Staff / Admin", icon: Briefcase },
  { id: "equity", label: "Partner Equity", icon: HandCoins, execOnly: true },
];

const STATE_META: Record<
  PayrollLineItem["state"],
  { label: string; className: string }
> = {
  PENDING_VERIFICATION: { label: "Pending Verifikasi", className: "bg-[#fffbeb] text-[#92400e] border-[#fcd34d]" },
  APPROVED: { label: "Disetujui", className: "bg-[#eff6ff] text-[#1e40af] border-[#bfdbfe]" },
  READY_FOR_DISBURSEMENT: { label: "Siap Cair", className: "bg-[#ecfdf5] text-[#065f46] border-[#a7f3d0]" },
  PAID: { label: "Dibayar", className: "bg-[#09090b] text-white border-[#09090b]" },
  VOID: { label: "Dibatalkan", className: "bg-[#fafafa] text-[#a1a1aa] border-[#e4e4e7]" },
};

function StatCard({
  label, value, sub, icon: Icon, tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof Wallet;
  tone: "neutral" | "amber" | "emerald" | "obsidian";
}) {
  const tones = {
    neutral: "border-[#ececee] bg-white text-[#09090b]",
    amber: "border-[#fcd34d] bg-[#fffbeb] text-[#78350f]",
    emerald: "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]",
    obsidian: "border-[#09090b] bg-[#09090b] text-white",
  } as const;
  const iconTone = {
    neutral: "text-[#71717a]",
    amber: "text-[#b45309]",
    emerald: "text-[#059669]",
    obsidian: "text-white/70",
  } as const;

  return (
    <div className={`rounded-[18px] border p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] opacity-70">{label}</p>
        <Icon size={15} className={iconTone[tone]} aria-hidden="true" />
      </div>
      <p className="mt-2 font-mono text-xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-[11px] opacity-70">{sub}</p>
    </div>
  );
}

export function PayrollHubClient({
  initialSummary,
  initialLines,
  rank,
}: {
  initialSummary: PayrollSummary;
  initialLines: PayrollLineItem[];
  rank: number;
}) {
  const [tab, setTab] = useState<PayrollTab>("all");
  const [base, setBase] = useState(initialLines);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Optimistic state so a status change does not wait on the round trip.
  const [lines, applyOptimistic] = useOptimistic(
    base,
    (state: PayrollLineItem[], action: { id: string; state: PayrollLineItem["state"] }) =>
      state.map((l) => (l.id === action.id ? { ...l, state: action.state } : l)),
  );

  const canSeeDividends = initialSummary.canSeeDividends && rank >= 100;
  const visibleTabs = TABS.filter((t) => !t.execOnly || canSeeDividends);

  const filtered = useMemo(
    () => (tab === "all" ? lines : lines.filter((l) => {
      if (tab === "crew") return l.kind === "CREW_FEE";
      if (tab === "editor") return l.kind === "EDITOR_RATE";
      if (tab === "staff") return l.kind === "SALARY";
      if (tab === "equity") return l.kind === "DIVIDEND";
      return true;
    })),
    [lines, tab],
  );

  const advance = (
    line: PayrollLineItem,
    next: "APPROVED" | "READY_FOR_DISBURSEMENT" | "PAID",
  ) => {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ id: line.id, state: next });
      const res = await advanceLineItemState(line.id, next);
      if (!res.success) {
        setError(res.error ?? "Gagal memperbarui status.");
        return;
      }
      setBase((prev) => prev.map((l) => (l.id === line.id ? { ...l, state: next } : l)));
    });
  };

  const exportCsv = () => {
    const header = ["Nama", "Tipe", "Proyek", "Peran", "Tanggal", "Bruto", "Potongan", "Neto", "Status", "Slip"];
    const rows = filtered.map((l) => [
      l.payeeName, l.payeeType, l.projectName ?? "-", l.roleLabel ?? "-", l.earnedOn,
      l.grossAmount, l.deductionAmount, l.netAmount, l.state, l.slipNumber ?? "-",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${initialSummary.periodLabel || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-1">Kompensasi</p>
          <h1 className="font-serif text-2xl font-bold tracking-tight text-[#09090b]">
            Payroll &amp; Kompensasi
          </h1>
          <p className="mt-1 text-sm text-[#71717a]">
            Periode aktif <strong className="text-[#09090b]">{initialSummary.periodLabel || "—"}</strong>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex min-h-10 items-center gap-2 rounded-[12px] border border-[#ececee] bg-white px-3.5 text-xs font-semibold text-[#18181b] hover:bg-[#fafafa]"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </header>

      {/* ── KPI strip ───────────────────────────────────────────────────── */}
      <section aria-label="Ringkasan payroll" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Gaji Belum Terbayar"
          value={formatRupiah(initialSummary.pendingPayout)}
          sub={`${initialSummary.awaitingVerificationCount} menunggu verifikasi`}
          icon={Wallet}
          tone="amber"
        />
        <StatCard
          label="Terbayar Bulan Ini"
          value={formatRupiah(initialSummary.currentMonthPayout)}
          sub="Pencairan selesai periode ini"
          icon={TrendingUp}
          tone="emerald"
        />
        {canSeeDividends ? (
          <StatCard
            label="Cadangan Operasional (5%)"
            value={formatRupiah(initialSummary.reserveAccumulated)}
            sub={`Dividen tertunda ${formatRupiah(initialSummary.dividendPending)}`}
            icon={PiggyBank}
            tone="neutral"
          />
        ) : (
          <StatCard
            label="Cadangan Operasional (5%)"
            value="—"
            sub="Akses Founder diperlukan"
            icon={ShieldAlert}
            tone="neutral"
          />
        )}
        <StatCard
          label="Antrean Siap Cair"
          value={String(initialSummary.readyCount)}
          sub="Baris terverifikasi menunggu pembayaran"
          icon={Clock3}
          tone="obsidian"
        />
      </section>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#ececee] pb-2">
        {visibleTabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={active}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-[10000px] px-3 text-xs font-semibold transition-colors ${
                active
                  ? "bg-[#09090b] text-white"
                  : "text-[#52525b] hover:bg-[#fafafa]"
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {error ? (
        <div role="alert" className="rounded-[14px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-sm text-[#991b1b]">
          {error}
        </div>
      ) : null}

      {/* ── Ledger ────────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-[#d4d4d8] px-6 py-16 text-center">
          <CalendarClock size={30} className="mx-auto mb-3 text-[#a1a1aa]" aria-hidden="true" />
          <p className="font-medium text-[#09090b]">Belum ada kompensasi pada filter ini</p>
          <p className="mt-1 text-sm text-[#71717a]">
            Baris akan muncul setelah penugasan kru diterima atau tugas editor selesai.
          </p>
        </div>
      ) : (
        <div className={`overflow-hidden rounded-[18px] border border-[#ececee] bg-white ${isPending ? "opacity-70" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#ececee] bg-[#fafafa] text-left text-[10px] uppercase tracking-[0.1em] text-[#71717a]">
                  <th className="px-4 py-2.5 font-semibold">Penerima</th>
                  <th className="hidden px-4 py-2.5 font-semibold lg:table-cell">Proyek</th>
                  <th className="hidden px-4 py-2.5 font-semibold sm:table-cell">Tanggal</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Neto</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f4f4f5]">
                {filtered.map((line) => {
                  const meta = STATE_META[line.state];
                  const isEquity = line.kind === "DIVIDEND";
                  return (
                    <tr key={line.id} className="hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#09090b]">{line.payeeName}</p>
                        <p className="mt-0.5 text-[11px] text-[#71717a]">
                          {isEquity ? "Partner · Equity" : line.payeeRole ?? line.roleLabel ?? "—"}
                        </p>
                      </td>
                      <td className="hidden max-w-[220px] truncate px-4 py-3 text-[#52525b] lg:table-cell">
                        {line.projectName ?? "—"}
                      </td>
                      <td className="hidden whitespace-nowrap px-4 py-3 text-[#52525b] sm:table-cell">
                        {new Date(line.earnedOn).toLocaleDateString("id-ID", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums text-[#09090b]">
                        {formatRupiah(line.netAmount)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.className}`}>
                          {meta.label}
                        </span>
                        {line.slipNumber ? (
                          <p className="mt-1 font-mono text-[10px] text-[#a1a1aa]">{line.slipNumber}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          {line.state === "PENDING_VERIFICATION" ? (
                            <button
                              type="button"
                              onClick={() => advance(line, "APPROVED")}
                              className="inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-[#ececee] px-2.5 text-[11px] font-semibold text-[#18181b] hover:bg-white"
                            >
                              <CheckCircle2 size={12} /> Verifikasi
                            </button>
                          ) : null}
                          {line.state === "APPROVED" ? (
                            <button
                              type="button"
                              onClick={() => advance(line, "READY_FOR_DISBURSEMENT")}
                              className="inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-[#ececee] px-2.5 text-[11px] font-semibold text-[#18181b] hover:bg-white"
                            >
                              Siap Cair
                            </button>
                          ) : null}
                          {line.state === "READY_FOR_DISBURSEMENT" && rank >= 100 ? (
                            <button
                              type="button"
                              onClick={() => advance(line, "PAID")}
                              className="inline-flex min-h-8 items-center gap-1 rounded-[8px] bg-[#09090b] px-2.5 text-[11px] font-semibold text-white hover:bg-[#27272a]"
                            >
                              <Wallet size={12} /> Bayar
                            </button>
                          ) : null}
                          {line.payslipId ? (
                            <Link
                              href={`/admin/payroll/slips/${line.payslipId}`}
                              className="inline-flex min-h-8 items-center gap-1 rounded-[8px] border border-[#ececee] px-2.5 text-[11px] font-semibold text-[#18181b] hover:bg-white"
                            >
                              <FileText size={12} /> Slip
                            </Link>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
