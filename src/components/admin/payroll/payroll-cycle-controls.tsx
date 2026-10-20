"use client";

import { useState, useTransition } from "react";
import {
  CalendarRange, Loader2, Sparkles, X, AlertTriangle, CheckCircle2,
  Lock, Banknote, ShieldAlert,
} from "lucide-react";
import {
  generatePayrollCycleAction,
  previewPayrollCycle,
  lockPayrollCycleAction,
  disbursePayrollCycleAction,
  type CyclePreview,
  type PayrollCycleInfo,
} from "@/app/actions/payroll";
import { currentPayrollPeriod, payrollPeriodLabel } from "@/lib/payroll/period";
import { formatRupiah } from "@/lib/reminders/compose";

/**
 * Payroll cycle controls: generate, lock, disburse.
 *
 * Every mutating call goes through a Server Action that re-resolves rank from
 * the session. `rank` here only decides which CONTROLS to render — it is never
 * sent as an authority claim, and the database checks again regardless.
 */

const monthLabel = payrollPeriodLabel;

export function PayrollCycleControls({
  initialCycle,
  rank,
  canSeeDividends,
  onChanged,
}: {
  initialCycle: PayrollCycleInfo | null;
  rank: number;
  canSeeDividends: boolean;
  /** Called with the new cycle status after any successful action. */
  onChanged?: (status?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(currentPayrollPeriod());
  const [preview, setPreview] = useState<CyclePreview | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [cycle, setCycle] = useState(initialCycle);
  const [includeDividends, setIncludeDividends] = useState(false);
  const [busy, startTransition] = useTransition();

  const isFounder = rank >= 100;
  /*
   * Dividends require BOTH founder rank AND a dividend-capable summary. The
   * server recomputes this anyway; the UI simply avoids offering a checkbox
   * that would be ignored.
   */
  const showDividendOption = isFounder && canSeeDividends;
  const frozen = cycle?.status === "DISBURSED" || cycle?.status === "CLOSED";

  const refreshPreview = (p: string) => {
    setPeriod(p);
    setPreview(null);
    startTransition(async () => {
      const res = await previewPayrollCycle(p);
      setPreview(res);
    });
  };

  const openDialog = () => {
    setMessage(null);
    setOpen(true);
    refreshPreview(period);
  };

  const generate = () => {
    setMessage(null);
    startTransition(async () => {
      const res = await generatePayrollCycleAction(
        period,
        showDividendOption && includeDividends,
      );
      if (!res.success) {
        setMessage({ tone: "err", text: res.message ?? res.error });
        return;
      }
      setMessage({
        tone: "ok",
        text:
          res.slipsCreated === 0
            ? "Tidak ada kompensasi baru pada periode ini."
            : `${res.slipsCreated} slip dibuat · ${formatRupiah(res.totalDisbursement)}`,
      });
      setOpen(false);
      const info = await previewPayrollCycle(period);
      void info;
      onChanged?.();
      // Re-read the cycle header so the banner reflects the new state.
      const { getPayrollCycle } = await import("@/app/actions/payroll");
      setCycle(await getPayrollCycle(period));
    });
  };

  const lock = () => {
    if (!cycle) return;
    setMessage(null);
    startTransition(async () => {
      const res = await lockPayrollCycleAction(cycle.id);
      if (!res.success) {
        setMessage({ tone: "err", text: res.message ?? res.error });
        return;
      }
      setCycle({ ...cycle, status: res.status });
      setMessage({ tone: "ok", text: "Siklus dikunci. Baris kompensasi dibekukan." });
      onChanged?.(res.status);
    });
  };

  const disburse = () => {
    if (!cycle) return;
    setMessage(null);
    startTransition(async () => {
      const res = await disbursePayrollCycleAction(cycle.id);
      if (!res.success) {
        setMessage({ tone: "err", text: res.message ?? res.error });
        return;
      }
      setCycle({ ...cycle, status: "DISBURSED" });
      setMessage({
        tone: "ok",
        text: `Dicairkan · ${res.slips ?? 0} slip · ${formatRupiah(res.totalDisbursement ?? 0)}`,
      });
      onChanged?.("DISBURSED");
    });
  };

  return (
    <div className="space-y-3">
      {/* ── Status banner ────────────────────────────────────────────────── */}
      {cycle ? (
        <div
          className={`flex flex-col gap-3 rounded-[16px] border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${
            frozen
              ? "border-[#a7f3d0] bg-[#ecfdf5]"
              : cycle.status === "LOCKED"
                ? "border-[#bfdbfe] bg-[#eff6ff]"
                : "border-[#fcd34d] bg-[#fffbeb]"
          }`}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5">
              {frozen ? (
                <CheckCircle2 size={16} className="text-[#059669]" aria-hidden="true" />
              ) : cycle.status === "LOCKED" ? (
                <Lock size={16} className="text-[#1e40af]" aria-hidden="true" />
              ) : (
                <AlertTriangle size={16} className="text-[#b45309]" aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="text-[12px] font-semibold text-[#09090b]">
                Siklus {monthLabel(cycle.periodKey)} ·{" "}
                <span className="font-mono text-[11px]">{cycle.status}</span>
              </p>
              <p className="mt-0.5 text-[11px] text-[#71717a]">
                {cycle.slipCount} slip · {formatRupiah(cycle.totalNet)}
                {cycle.status === "DRAFT"
                  ? " · masih dapat diubah"
                  : cycle.status === "LOCKED"
                    ? " · dibekukan, menunggu pencairan"
                    : " · selesai dicairkan"}
              </p>
            </div>
          </div>

          {isFounder ? (
            <div className="flex gap-2">
              {cycle.status === "DRAFT" ? (
                <button
                  type="button"
                  onClick={lock}
                  disabled={busy || cycle.slipCount === 0}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border border-[#bfdbfe] bg-white px-3 text-[11px] font-semibold text-[#1e40af] hover:bg-[#eff6ff] disabled:opacity-50"
                >
                  <Lock size={12} /> Kunci Siklus
                </button>
              ) : null}
              {cycle.status === "LOCKED" || cycle.status === "DRAFT" ? (
                <button
                  type="button"
                  onClick={disburse}
                  disabled={busy || cycle.slipCount === 0}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-[10px] bg-[#065f46] px-3 text-[11px] font-semibold text-white hover:bg-[#065f46]/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Banknote size={12} />}
                  Tandai Lunas / Cairkan
                </button>
              ) : null}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[#71717a]">
              <ShieldAlert size={11} /> Pencairan hanya oleh Founder
            </span>
          )}
        </div>
      ) : null}

      {message ? (
        <div
          role="status"
          className={`rounded-[12px] border px-3.5 py-2.5 text-[12px] ${
            message.tone === "ok"
              ? "border-[#a7f3d0] bg-[#ecfdf5] text-[#065f46]"
              : "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {/* ── Generate trigger ─────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={openDialog}
        disabled={busy || frozen}
        className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-[#09090b] px-4 text-xs font-semibold text-white hover:bg-[#27272a] disabled:opacity-50"
      >
        <Sparkles size={14} /> Generate Siklus Gaji
      </button>

      {/* ── Dialog ───────────────────────────────────────────────────────── */}
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090b]/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cycle-dialog-title"
        >
          <div className="w-full max-w-md rounded-[18px] border border-[#ececee] bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 id="cycle-dialog-title" className="font-serif text-lg font-bold text-[#09090b]">
                  Generate Siklus Gaji
                </h2>
                <p className="mt-0.5 text-[11px] text-[#71717a]">
                  Semua kompensasi disetujui pada periode ini akan dikelompokkan per penerima.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[8px] p-1 text-[#a1a1aa] hover:bg-[#fafafa]"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <label className="mt-4 block text-[11px] font-semibold uppercase tracking-wide text-[#71717a]">
              Periode
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => refreshPreview(e.target.value)}
              className="mt-1.5 w-full rounded-[10px] border border-[#ececee] px-3 py-2 text-sm text-[#09090b] focus:border-[#09090b] focus:outline-none"
            />

            {showDividendOption ? (
              <label className="mt-3 flex items-start gap-2 text-[11px] text-[#52525b]">
                <input
                  type="checkbox"
                  checked={includeDividends}
                  onChange={(e) => setIncludeDividends(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Sertakan dividen partner (hanya Founder).{" "}
                  {preview && preview.dividendLines > 0
                    ? `${preview.dividendLines} baris dividen tersedia.`
                    : "Tidak ada dividen tertunda."}
                </span>
              </label>
            ) : null}

            {/* Pre-flight preview */}
            <dl className="mt-4 divide-y divide-[#f4f4f5] rounded-[12px] border border-[#ececee]">
              {[
                ["Baris kompensasi", preview ? String(preview.lines) : "…"],
                ["Penerima (headcount)", preview ? String(preview.headcount) : "…"],
                ["Estimasi pencairan", preview ? formatRupiah(preview.totalNet) : "…"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-3.5 py-2.5">
                  <dt className="text-[11px] text-[#71717a]">{k}</dt>
                  <dd className="font-mono text-[12px] font-semibold tabular-nums text-[#09090b]">{v}</dd>
                </div>
              ))}
            </dl>

            {preview?.existingCycleStatus && preview.existingCycleStatus !== "DRAFT" ? (
              <p className="mt-3 rounded-[10px] bg-[#fffbeb] px-3 py-2 text-[11px] text-[#92400e]">
                Periode ini sudah memiliki siklus <strong>{preview.existingCycleStatus}</strong>. Generate ulang
                tidak akan menambah slip baru.
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-10 rounded-[12px] border border-[#ececee] px-4 text-xs font-semibold text-[#3f3f46] hover:bg-[#fafafa]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={busy || !preview || preview.lines === 0}
                className="inline-flex min-h-10 items-center gap-2 rounded-[12px] bg-[#09090b] px-4 text-xs font-semibold text-white hover:bg-[#27272a] disabled:opacity-50"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CalendarRange size={13} />}
                {busy ? "Memproses…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
