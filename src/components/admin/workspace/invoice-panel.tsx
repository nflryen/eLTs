"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Receipt,
  Printer,
  MessageCircle,
  Check,
  Clock,
  Plus,
  X,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { Card, CardHeader, CardInner, Badge, StatTile } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import { jakartaShortDate } from "@/lib/datetime";
import { idr } from "@/lib/format";
import { recordPayment, verifyReceipt, deleteReceipt } from "@/app/actions/invoice-receipts";
import type { WorkspacePayload, InvoicePosition, Receipt as ReceiptRow } from "@/lib/workspace";

/**
 * Client Invoice panel — the client-facing money screen.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * -------------------------------
 * `ModuleInvoice` in `modules.tsx` is a thin re-export of this component, so the
 * whole billing surface (KPIs, line items, the receipt logger, the print and
 * WhatsApp actions) can evolve without colliding with the other workspace
 * modules that share `modules.tsx`.
 *
 * ZERO LEAKAGE
 * ------------
 * This component renders ONLY the `invoice` sub-object of the payload. It never
 * reads studio-private cost, profitability, or partner-split data, and never
 * surfaces a private RAB field — those live in the private RAB module and must
 * never appear on a screen a client might see.
 *
 * THE VERIFICATION GATE
 * ---------------------
 * An unverified receipt is a CLAIM, not cash: `v_invoice_financial_position`
 * only counts rows where `verified_at IS NOT NULL` toward the balance. Every
 * unverified row is therefore labelled "tidak dihitung ke saldo" so an operator
 * is never misled into thinking the client has paid.
 */

const PAYMENT_METHODS = [
  { value: "BANK_TRANSFER", label: "Transfer Bank" },
  { value: "CASH", label: "Tunai" },
  { value: "QRIS", label: "QRIS" },
  { value: "E_WALLET", label: "E-Wallet" },
  { value: "CHEQUE", label: "Cek / Giro" },
  { value: "CREDIT_NOTE", label: "Nota Kredit" },
] as const;

const APPLIED_TO = [
  { value: "DP", label: "DP" },
  { value: "FINAL_BALANCE", label: "Pelunasan" },
  { value: "ADDON", label: "Tambahan" },
  { value: "LATE_FEE", label: "Denda Keterlambatan" },
  { value: "DAMAGE", label: "Kerusakan" },
  { value: "UNALLOCATED", label: "Belum dialokasikan" },
] as const;

type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
type AppliedTo = (typeof APPLIED_TO)[number]["value"];

const APPLIED_TO_LABEL: Record<string, string> = Object.fromEntries(
  APPLIED_TO.map((a) => [a.value, a.label]),
);

/** Jakarta today as `YYYY-MM-DD`, the value a native date input expects. */
function jakartaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function InvoicePanel({ data }: { data: WorkspacePayload }) {
  const inv = data.invoice;
  const projectId = data.project.id;

  /*
   * `Date.now()` is impure — calling it inline during render makes the output
   * non-deterministic and breaks React Compiler memoisation. Captured once per
   * mount above the early return so hook order stays unconditional; the panel
   * is only mounted while its tab is open, so mount time is a faithful "now".
   */
  const [nowMs] = useState(() => Date.now());

  if (!inv) {
    return (
      <Card>
        <EmptyState
          icon={<Receipt size={20} />}
          title="Belum ada invoice terbit"
          description="Terbitkan invoice komersial untuk memulai penagihan klien."
        />
      </Card>
    );
  }



  const attention =
    inv.derived_status === "UNPAID" ||
    (inv.derived_status === "PARTIALLY_PAID" &&
      Number.isFinite(Date.parse(inv.due_date)) &&
      Date.parse(inv.due_date) < nowMs);
  const paidPct =
    inv.contract_value > 0 ? Math.round((inv.paid_amount / inv.contract_value) * 100) : 0;
  const waText = buildClientMessage(inv, data.project.name);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={inv.invoice_number}
          description={`Terbit ${inv.issue_date} · Jatuh tempo ${inv.due_date}`}
          action={
            <Badge variant={attention ? "ember" : "outline"}>{
              inv.derived_status.replace(/_/g, " ")
            }</Badge>
          }
        />

        {/* The four tiles that answer every billing question at a glance. */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Nilai Kontrak" value={idr(inv.contract_value)} />
          <StatTile label="Dibayar" value={idr(inv.paid_amount)} hint={`${paidPct}% dari kontrak`} />
          <StatTile
            label="Sisa Pelunasan"
            value={idr(inv.balance_due)}
            emphasis={inv.balance_due <= 0 && inv.contract_value > 0}
          />
          <StatTile
            label={`Min. DP (${inv.minimum_dp_pct}%)`}
            value={idr(inv.minimum_dp_required)}
            hint={
              <span className={inv.dp_floor_satisfied ? "text-[#09090b]" : "text-[#ff5a00]"}>
                {inv.dp_floor_satisfied ? "✅ terpenuhi" : "belum terpenuhi"}
              </span>
            }
          />
        </div>

        {inv.unverified_amount > 0 ? (
          <p className="mt-3 rounded-[12px] border border-[#ff5a00] bg-[#fafafa] px-3 py-2 text-[11px] font-medium text-[#ff5a00]">
            {idr(inv.unverified_amount)} menunggu verifikasi — belum dihitung ke saldo.
          </p>
        ) : null}

        {inv.overpayment_amount > 0 ? (
          <p className="mt-3 rounded-[12px] border border-[#ececee] bg-[#fafafa] px-3 py-2 text-[11px] font-medium text-[#09090b]">
            Kelebihan bayar {idr(inv.overpayment_amount)} — catat sebagai kredit atau proses refund.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <RecordPaymentButton invoiceId={inv.invoice_id} balanceDue={inv.balance_due} />
          <Link
            href={`/invoice/${encodeURIComponent(inv.invoice_number)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] border border-[#ececee] bg-white px-3.5 text-xs font-semibold text-[#18181b] transition-colors hover:bg-[#fafafa]"
          >
            <Printer size={14} /> Cetak PDF
          </Link>
          <CopyTextButton text={waText} label="Salin WA" icon={<MessageCircle size={14} />} />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Rincian Layanan"
          description="Hanya nilai kontrak — tanpa biaya internal"
        />
        {inv.line_items.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Belum ada rincian layanan" />
          </div>
        ) : (
          <CardInner className="mt-4 p-0">
            <div className="divide-y divide-[#ececee]">
              {inv.line_items.map((li, i) => (
                <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#18181bcc]">{li.description}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-[#71717a]">
                      {li.quantity} × {idr(li.unit_price)}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-[#09090b]">
                    {idr(li.subtotal)}
                  </span>
                </div>
              ))}
            </div>
          </CardInner>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Riwayat Pembayaran"
          description="Hanya pembayaran terverifikasi dihitung ke saldo"
        />
        {inv.receipts.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Belum ada pembayaran tercatat"
              description="Catat transfer klien untuk memperbarui saldo."
            />
          </div>
        ) : (
          <div className="mt-4 divide-y divide-[#ececee]">
            {inv.receipts.map((r) => (
              <ReceiptLine key={r.id} receipt={r} projectId={projectId} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function ReceiptLine({ receipt: r, projectId }: { receipt: ReceiptRow; projectId: string }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gone) return null;

  const verify = () => {
    setError(null);
    start(async () => {
      const res = await verifyReceipt(r.id, projectId);
      if (!res.success) setError(res.error ?? "Gagal memverifikasi.");
    });
  };

  const remove = () => {
    setError(null);
    start(async () => {
      const res = await deleteReceipt(r.id, projectId);
      if (res.success) setGone(true);
      else setError(res.error ?? "Gagal menghapus.");
    });
  };

  return (
    <div className={`flex items-start justify-between gap-3 py-3 ${pending ? "opacity-60" : ""}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11px] font-semibold text-[#18181b]">
            {r.receipt_number}
          </span>
          {r.verified ? (
            <Badge variant="outline">Verified</Badge>
          ) : (
            <Badge variant="ember">Belum diverifikasi</Badge>
          )}
        </div>
        <p className="mt-1 text-[10px] text-[#71717a]">
          {jakartaShortDate(r.received_at)}
          {r.bank_name ? ` · ${r.bank_name}` : ""}
          {` · ${APPLIED_TO_LABEL[r.applied_to] ?? r.applied_to}`}
        </p>
        {!r.verified ? (
          <p className="mt-0.5 text-[10px] font-medium text-[#ff5a00]">tidak dihitung ke saldo</p>
        ) : null}
        {error ? <p className="mt-0.5 text-[10px] font-medium text-[#ff5a00]">{error}</p> : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span
          className={`font-mono text-xs font-bold tabular-nums ${
            r.verified ? "text-[#09090b]" : "text-[#71717a]"
          }`}
        >
          {idr(r.amount)}
        </span>
        {!r.verified ? (
          <button
            type="button"
            onClick={verify}
            disabled={pending}
            className="inline-flex min-h-9 items-center gap-1 rounded-[10px] border border-[#3f3f46] bg-[#3f3f46] px-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#27272a] disabled:opacity-60"
          >
            <CheckCircle2 size={12} /> Verifikasi
          </button>
        ) : null}
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          aria-label={`Hapus kwitansi ${r.receipt_number}`}
          className="inline-flex min-h-9 items-center rounded-[10px] border border-[#ececee] px-2 text-[#71717a] transition-colors hover:bg-[#fafafa] hover:text-[#ff5a00] disabled:opacity-60"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function CopyTextButton({
  text,
  label,
  icon,
}: {
  text: string;
  label: string;
  icon: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Clipboard is unavailable in insecure contexts; fall back to a
        // selection copy so the operator is never left without the text.
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Clipboard diblokir browser.");
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={run}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] border border-[#ececee] bg-white px-3.5 text-xs font-semibold text-[#18181b] transition-colors hover:bg-[#fafafa]"
      >
        {copied ? <Check size={14} /> : icon}
        {copied ? "Tersalin!" : label}
      </button>
      {error ? <p className="text-[10px] font-medium text-[#ff5a00]">{error}</p> : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

function RecordPaymentButton({
  invoiceId,
  balanceDue,
}: {
  invoiceId: string;
  balanceDue: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("BANK_TRANSFER");
  const [bankName, setBankName] = useState("");
  const [reference, setReference] = useState("");
  const [appliedTo, setAppliedTo] = useState<AppliedTo>("UNALLOCATED");
  const [receivedAt, setReceivedAt] = useState(jakartaToday);
  const [notes, setNotes] = useState("");
  const [verified, setVerified] = useState(true);

  // Live preview of the post-payment balance. Clamped at zero, with the excess
  // surfaced separately so an overpayment is visible before it is submitted.
  const preview = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const remaining = Math.max(balanceDue - n, 0);
    const excess = Math.max(n - balanceDue, 0);
    return { remaining, excess };
  }, [amount, balanceDue]);

  const reset = () => {
    setAmount("");
    setMethod("BANK_TRANSFER");
    setBankName("");
    setReference("");
    setAppliedTo("UNALLOCATED");
    setReceivedAt(jakartaToday());
    setNotes("");
    setVerified(true);
    setStatus(null);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);

    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setStatus({ kind: "err", message: "Nominal harus lebih besar dari nol." });
      return;
    }

    start(async () => {
      const res = await recordPayment({
        invoiceId,
        amount: n,
        paymentMethod: method,
        bankName: bankName.trim() || undefined,
        referenceNumber: reference.trim() || undefined,
        appliedTo,
        receivedAt: receivedAt ? `${receivedAt}T00:00:00+07:00` : undefined,
        notes: notes.trim() || undefined,
        verified,
      });

      if (!res.success) {
        setStatus({ kind: "err", message: res.error ?? "Gagal mencatat pembayaran." });
        return;
      }

      setStatus({
        kind: "ok",
        message: `Kwitansi ${res.receiptNumber} tercatat.`,
      });
      setAmount("");
      setReference("");
      setNotes("");
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] bg-[#ff5a00] px-3.5 text-xs font-semibold text-white transition-colors hover:bg-[#e65100]"
      >
        <Plus size={14} /> Catat Pembayaran
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
          <div
            className="relative my-auto w-full max-w-lg rounded-[20px] border border-[#ececee] bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-payment-title"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="record-payment-title" className="text-base font-semibold text-[#09090b]">
                  Catat Pembayaran Klien
                </h3>
                <p className="mt-0.5 text-xs text-[#52525b]">
                  Nomor kwitansi dibuat otomatis oleh sistem.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Tutup"
                className="rounded-[10px] p-1.5 text-[#71717a] transition-colors hover:bg-[#fafafa] hover:text-[#09090b]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={submit} className="mt-5 space-y-4">
              <Field label="Nominal (Rp)">
                <input
                  type="number"
                  min="1"
                  step="any"
                  inputMode="numeric"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-[12px] border border-[#ececee] px-3 py-2.5 font-mono text-sm tabular-nums text-[#09090b] outline-none focus:border-[#ff5a00]"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Metode">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2.5 text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Alokasi">
                  <select
                    value={appliedTo}
                    onChange={(e) => setAppliedTo(e.target.value as AppliedTo)}
                    className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2.5 text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                  >
                    {APPLIED_TO.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Bank">
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="BCA / Mandiri / …"
                    className="w-full rounded-[12px] border border-[#ececee] px-3 py-2.5 text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                  />
                </Field>

                <Field label="No. Referensi">
                  <input
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="Nomor transfer"
                    className="w-full rounded-[12px] border border-[#ececee] px-3 py-2.5 font-mono text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                  />
                </Field>
              </div>

              <Field label="Tanggal Diterima">
                <input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                  className="w-full rounded-[12px] border border-[#ececee] px-3 py-2.5 text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                />
              </Field>

              <Field label="Catatan">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Opsional"
                  className="w-full resize-none rounded-[12px] border border-[#ececee] px-3 py-2.5 text-sm text-[#09090b] outline-none focus:border-[#ff5a00]"
                />
              </Field>

              <label className="flex items-center gap-2.5 rounded-[12px] border border-[#ececee] bg-[#fafafa] px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={verified}
                  onChange={(e) => setVerified(e.target.checked)}
                  className="h-4 w-4 accent-[#ff5a00]"
                />
                <span className="text-xs font-medium text-[#18181b]">
                  Sudah diverifikasi — hitung ke saldo
                </span>
              </label>

              {preview ? (
                <div className="rounded-[12px] border border-[#ececee] bg-[#fafafa] px-3 py-2.5">
                  <p className="text-xs text-[#52525b]">
                    Sisa setelah pembayaran:{" "}
                    <span className="font-mono font-semibold tabular-nums text-[#09090b]">
                      {idr(preview.remaining)}
                    </span>
                  </p>
                  {preview.excess > 0 ? (
                    <p className="mt-0.5 text-xs text-[#ff5a00]">
                      Kelebihan:{" "}
                      <span className="font-mono font-semibold tabular-nums">
                        {idr(preview.excess)}
                      </span>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {status ? (
                <p
                  className={`rounded-[12px] px-3 py-2 text-xs font-medium ${
                    status.kind === "ok"
                      ? "border border-[#ececee] bg-[#fafafa] text-[#09090b]"
                      : "border border-[#ff5a00] bg-[#fafafa] text-[#ff5a00]"
                  }`}
                >
                  {status.message}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t border-[#ececee] pt-4">
                <button
                  type="button"
                  onClick={close}
                  className="inline-flex min-h-11 items-center rounded-[12px] border border-[#ececee] px-4 text-xs font-semibold text-[#52525b] transition-colors hover:bg-[#fafafa]"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-[12px] bg-[#ff5a00] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#e65100] disabled:opacity-60"
                >
                  {pending ? <Clock size={14} /> : <Check size={14} />}
                  {pending ? "Menyimpan…" : "Simpan Pembayaran"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#71717a]">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Client-safe WhatsApp copy: amounts only, never any internal cost data. */
function buildClientMessage(inv: InvoicePosition, projectName: string): string {
  const lines = [
    `Halo, berikut ringkasan tagihan untuk *${projectName}*:`,
    ``,
    `Invoice: ${inv.invoice_number}`,
    `Nilai kontrak: ${idr(inv.contract_value)}`,
    `Sudah dibayar: ${idr(inv.paid_amount)}`,
    `Sisa pelunasan: ${idr(inv.balance_due)}`,
    `Jatuh tempo: ${inv.due_date}`,
    ``,
    `Terima kasih.`,
  ];
  return lines.join("\n");
}
