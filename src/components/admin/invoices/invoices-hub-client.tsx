"use client";

import { useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Receipt,
  Printer,
  MessageCircle,
  Check,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  Coins,
  TrendingUp,
  Package,
  Building2,
  ExternalLink,
  CreditCard,
  ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/glass";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import type { StudioBankAccount } from "@/lib/studio/payment-methods";
import { clientUrl } from "@/lib/domain";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { recordPayment } from "@/app/actions/invoice-receipts";
import {
  CreateRentalInvoiceModal,
} from "./create-rental-invoice-modal";
import {
  getGlobalInvoicesList,
  type GlobalInvoiceListItem,
  type GlobalInvoicesOverview,
  type AvailableAsset,
  type AvailableProject,
} from "@/app/actions/invoice-actions";

interface InvoicesHubClientProps {
  initialOverview: GlobalInvoicesOverview;
  assets: AvailableAsset[];
  projects: AvailableProject[];
  /** Payment accounts from public.studio_payment_methods. */
  bankAccounts: StudioBankAccount[];
}

function formatIDR(amount: number): string {
  return `Rp ${Math.round(Number(amount) || 0).toLocaleString("id-ID")}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function InvoicesHubClient({
  initialOverview,
  assets,
  projects,
  bankAccounts,
}: InvoicesHubClientProps) {
  const router = useRouter();
  const [data, setData] = useState<GlobalInvoicesOverview>(initialOverview);

  // Filters state
  const [statusFilter, setStatusFilter] = useState<"ALL" | "UNPAID" | "PARTIALLY_PAID" | "PAID_IN_FULL">("ALL");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "RENTAL" | "PROJECT">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  // Payment Recording Modal State
  const [paymentInvoice, setPaymentInvoice] = useState<GlobalInvoiceListItem | null>(null);

  // Copied WhatsApp state
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);

  // Filtered invoices
  const filteredInvoices = useMemo(() => {
    return data.invoices.filter((inv) => {
      // Status filter
      if (statusFilter === "UNPAID" && inv.status !== "UNPAID") return false;
      if (statusFilter === "PARTIALLY_PAID" && inv.status !== "PARTIALLY_PAID") return false;
      if (statusFilter === "PAID_IN_FULL" && inv.status !== "PAID_IN_FULL" && inv.status !== "OVERPAID") return false;

      // Type filter
      if (typeFilter === "RENTAL" && inv.type !== "EQUIPMENT_RENTAL") return false;
      if (typeFilter === "PROJECT" && inv.type !== "PROJECT") return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNumber = inv.invoiceNumber.toLowerCase().includes(q);
        const matchesClient = inv.customerName.toLowerCase().includes(q);
        const matchesProject = inv.projectName.toLowerCase().includes(q);
        const matchesPhone = inv.customerPhone.toLowerCase().includes(q);
        if (!matchesNumber && !matchesClient && !matchesProject && !matchesPhone) return false;
      }

      return true;
    });
  }, [data.invoices, statusFilter, typeFilter, searchQuery]);

  // Handle WhatsApp Copy / Link
  const handleCopyWhatsApp = async (inv: GlobalInvoiceListItem) => {
    const bankLines =
      bankAccounts.length > 0
        ? `Rekening Resmi Pembayaran:\n${bankAccounts
            .map((b) => `• ${b.bank}: ${b.account_number} a.n. ${b.account_holder}`)
            .join("\n")}`
        : "Rekening pembayaran belum tersedia. Silakan hubungi studio.";

    const invoiceUrl = clientUrl(`/invoice/${encodeURIComponent(inv.invoiceNumber)}`);

    const text = `Halo Bapak/Ibu *${inv.customerName}*,\nBerikut kami sampaikan rincian tagihan resmi dari *ELTS Creative & Digital Studio*:\n\n📋 *Layanan:* ${inv.projectName}\n🧾 *No. Invoice:* ${inv.invoiceNumber}\n📅 *Jatuh Tempo:* ${formatDate(inv.dueDate)}\n\n💰 *Total Tagihan:* ${formatIDR(inv.grossAmount)}\n${
      inv.paidAmount > 0
        ? `✅ *Sudah Terbayar:* ${formatIDR(inv.paidAmount)}\n⏳ *Sisa Pelunasan:* ${formatIDR(inv.balanceDue)}`
        : `⏳ *Sisa Tagihan:* ${formatIDR(inv.balanceDue)}`
    }\n\n${bankLines}\n\n📄 Unduh / Cetak Invoice Resmi:\n${invoiceUrl}\n\nTerima kasih atas kerja samanya! 🙏`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopiedInvoiceId(inv.id);
      setTimeout(() => setCopiedInvoiceId(null), 2500);

      // Also open WhatsApp if valid phone
      const digits = inv.customerPhone.replace(/\D/g, "");
      const waNumber = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
      if (waNumber.length >= 8) {
        window.open(`https://wa.me/${waNumber}?text=${encodeURIComponent(text)}`, "_blank");
      }
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-6 pb-16">
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-[12px] bg-[#09090b] text-white">
              <Receipt size={18} />
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#09090b]">
              Faktur & Tagihan
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[#71717a] mt-1 ml-11">
            Manajemen invoice resmi untuk proyek produksi studio dan sewa lepas (dry-hire) gear.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <CreateRentalInvoiceModal
            assets={assets}
            projects={projects}
            bankAccounts={bankAccounts}
            onSuccess={(invNum) => {
              router.refresh();
              router.push(`/invoice/${encodeURIComponent(invNum)}`);
            }}
          />
        </div>
      </div>

      {/* ── KPI Metrics Overview ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Total Invoiced */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
              Total Tagihan Diterbitkan
            </span>
            <span className="size-8 rounded-[10px] bg-[#f4f4f5] flex items-center justify-center text-[#52525b]">
              <Receipt size={15} />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-[#09090b] tabular-nums font-mono sm:text-2xl">
            {formatIDR(data.metrics.totalInvoiced)}
          </p>
          <p className="mt-1 text-xs text-[#71717a]">
            {data.metrics.countTotal} invoice komersial terdaftar
          </p>
        </Card>

        {/* Total Collected */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
              Total Terbayar (Kas Masuk)
            </span>
            <span className="size-8 rounded-[10px] bg-[#f4f4f5] flex items-center justify-center text-[#09090b]">
              <TrendingUp size={15} />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-[#09090b] tabular-nums font-mono sm:text-2xl">
            {formatIDR(data.metrics.totalCollected)}
          </p>
          <p className="mt-1 text-xs text-[#09090b] font-medium">
            ✅ {data.metrics.countPaid} invoice lunas penuh
          </p>
        </Card>

        {/* Total Outstanding */}
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#71717a]">
              Sisa Piutang Berjalan
            </span>
            <span className="size-8 rounded-[10px] bg-[#ff5a00]/10 flex items-center justify-center text-[#ff5a00]">
              <Coins size={15} />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight text-[#ff5a00] tabular-nums font-mono sm:text-2xl">
            {formatIDR(data.metrics.totalOutstanding)}
          </p>
          <p className="mt-1 text-xs text-[#ff5a00] font-medium">
            {data.metrics.countUnpaid} belum bayar · {data.metrics.countPartiallyPaid} termin DP
          </p>
        </Card>
      </div>

      {/* ── Search & Filter Controls ─────────────────────────────────────── */}
      <Card className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Status Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === "ALL"
                  ? "bg-[#09090b] text-white"
                  : "border border-[#ececee] bg-white text-[#52525b] hover:bg-[#fafafa]"
              }`}
            >
              Semua ({data.metrics.countTotal})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("UNPAID")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === "UNPAID"
                  ? "bg-[#ff5a00] text-white"
                  : "border border-[#ececee] bg-white text-[#52525b] hover:bg-[#fafafa]"
              }`}
            >
              Belum Bayar ({data.metrics.countUnpaid})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("PARTIALLY_PAID")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === "PARTIALLY_PAID"
                  ? "bg-[#09090b] text-white"
                  : "border border-[#ececee] bg-white text-[#52525b] hover:bg-[#fafafa]"
              }`}
            >
              Termin DP ({data.metrics.countPartiallyPaid})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("PAID_IN_FULL")}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                statusFilter === "PAID_IN_FULL"
                  ? "bg-[#09090b] text-white"
                  : "border border-[#ececee] bg-white text-[#52525b] hover:bg-[#fafafa]"
              }`}
            >
              Lunas ({data.metrics.countPaid})
            </button>
          </div>

          {/* Type Filter & Search Input */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
              className="rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs font-semibold text-[#09090b] outline-none cursor-pointer"
            >
              <option value="ALL">Semua Tipe Layanan</option>
              <option value="RENTAL">Sewa Lepas (Rental)</option>
              <option value="PROJECT">Proyek Produksi</option>
            </select>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1a1aa]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari no. invoice, klien…"
                className="w-48 sm:w-60 rounded-[12px] border border-[#ececee] bg-white pl-8 pr-3 py-1.5 text-xs text-[#09090b] outline-none focus:border-[#09090b]"
              />
            </div>
          </div>
        </div>

        {/* ── Invoices Data Table ────────────────────────────────────────── */}
        {filteredInvoices.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={<Receipt size={24} />}
              title="Tidak ada invoice yang sesuai"
              description="Coba ubah filter status atau kata kunci pencarian."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-xs">
              <thead>
                <tr className="border-b border-[#ececee] text-[#71717a] font-semibold text-[11px] uppercase tracking-wider">
                  <th className="py-3 px-3">No. Invoice</th>
                  <th className="py-3 px-3">Tanggal</th>
                  <th className="py-3 px-3">Klien & Peruntukan</th>
                  <th className="py-3 px-3 text-right">Nilai Kontrak</th>
                  <th className="py-3 px-3 text-right">Terbayar</th>
                  <th className="py-3 px-3 text-right">Sisa Tagihan</th>
                  <th className="py-3 px-3 text-center">Status</th>
                  <th className="py-3 px-3 text-right">Aksi Cepat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ececee]">
                {filteredInvoices.map((inv) => {
                  const isPaid = inv.status === "PAID_IN_FULL" || inv.status === "OVERPAID";
                  const isPartial = inv.status === "PARTIALLY_PAID";
                  const isUnpaid = inv.status === "UNPAID";

                  return (
                    <tr key={inv.id} className="hover:bg-[#fafafa] transition-colors">
                      {/* Invoice Number & Type Badge */}
                      <td className="py-3.5 px-3">
                        <Link
                          href={`/invoice/${encodeURIComponent(inv.invoiceNumber)}`}
                          target="_blank"
                          className="font-mono font-bold text-[#09090b] hover:text-[#ff5a00] transition-colors inline-flex items-center gap-1.5"
                        >
                          {inv.invoiceNumber}
                          <ExternalLink size={11} className="text-[#a1a1aa]" />
                        </Link>
                        <div className="mt-1">
                          {inv.type === "EQUIPMENT_RENTAL" ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-2 py-0.5 text-[9px] font-bold uppercase text-[#ff5a00]">
                              <Package size={10} /> Sewa Alat
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-white px-2 py-0.5 text-[9px] font-semibold uppercase text-[#52525b]">
                              <Building2 size={10} /> Proyek
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Dates */}
                      <td className="py-3.5 px-3 space-y-0.5">
                        <p className="font-medium text-[#09090b]">
                          Terbit: {formatDate(inv.issueDate)}
                        </p>
                        <p className="text-[11px] text-[#71717a]">
                          Tempo: {formatDate(inv.dueDate)}
                        </p>
                      </td>

                      {/* Client & Project */}
                      <td className="py-3.5 px-3 max-w-xs">
                        <p className="font-semibold text-[#09090b] truncate">
                          {inv.customerName}
                          {inv.customerCompany ? ` (${inv.customerCompany})` : ""}
                        </p>
                        <p className="text-[11px] text-[#52525b] truncate">
                          {inv.projectName}
                        </p>
                        {inv.customerPhone && (
                          <p className="text-[10px] font-mono text-[#a1a1aa]">
                            WA: {inv.customerPhone}
                          </p>
                        )}
                      </td>

                      {/* Gross Amount */}
                      <td className="whitespace-nowrap py-3.5 px-3 text-right font-mono font-semibold text-[#09090b] tabular-nums">
                        {formatIDR(inv.grossAmount)}
                      </td>

                      {/* Paid Amount */}
                      <td className="py-3.5 px-3 text-right font-mono font-medium text-[#09090b] tabular-nums">
                        {formatIDR(inv.paidAmount)}
                      </td>

                      {/* Balance Due */}
                      <td className="py-3.5 px-3 text-right font-mono font-bold tabular-nums">
                        <span className={inv.balanceDue > 0 ? "text-[#ff5a00]" : "text-[#09090b]"}>
                          {formatIDR(inv.balanceDue)}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-3 text-center">
                        {isPaid && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#09090b] bg-[#09090b] px-2.5 py-1 text-[10px] font-bold text-white uppercase">
                            <CheckCircle2 size={11} /> Lunas
                          </span>
                        )}
                        {isPartial && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2.5 py-1 text-[10px] font-bold text-[#ff5a00] uppercase">
                            <Clock size={11} /> DP Masuk
                          </span>
                        )}
                        {isUnpaid && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#ff5a00] bg-[#fff6f2] px-2.5 py-1 text-[10px] font-bold text-[#ff5a00] uppercase">
                            Belum Bayar
                          </span>
                        )}
                      </td>

                      {/* Quick Actions */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Print Variant Dropdown */}
                          <PrintDropdownButton invoiceId={inv.id} invoiceNumber={inv.invoiceNumber} />
                          {/* WhatsApp Link / Copy */}
                          <button
                            type="button"
                            onClick={() => handleCopyWhatsApp(inv)}
                            title="Kirim Format Penagihan WhatsApp"
                            className="inline-flex size-8 items-center justify-center rounded-[10px] border border-[#ececee] bg-white text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors cursor-pointer"
                          >
                            {copiedInvoiceId === inv.id ? (
                              <Check size={13} className="text-[#09090b]" />
                            ) : (
                              <MessageCircle size={13} />
                            )}
                          </button>

                          {/* Record Payment Button */}
                          <button
                            type="button"
                            onClick={() => setPaymentInvoice(inv)}
                            title="Catat Pembayaran Masuk"
                            className="inline-flex items-center gap-1 rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#09090b] hover:bg-[#09090b] hover:text-white transition-colors cursor-pointer"
                          >
                            <CreditCard size={12} />
                            <span>Bayar</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Quick Record Payment Modal for Selected Row ──────────────────── */}
      {paymentInvoice && (
        <QuickPaymentModal
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onSuccess={async () => {
            setPaymentInvoice(null);
            router.refresh();
            const res = await getGlobalInvoicesList();
            if (res.success && res.data) {
              setData(res.data);
            }
          }}
        />
      )}
    </div>
  );
}

// ── Quick Payment Modal Component ──────────────────────────────────────────

function QuickPaymentModal({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: GlobalInvoiceListItem;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [amount, setAmount] = useState<string>(String(invoice.balanceDue > 0 ? invoice.balanceDue : 0));
  const [method, setMethod] = useState<"BANK_TRANSFER" | "CASH" | "QRIS">("BANK_TRANSFER");
  const [bankName, setBankName] = useState("BCA");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      setErrorMessage("Nominal pembayaran harus lebih besar dari Rp 0.");
      return;
    }

    startTransition(async () => {
      const res = await recordPayment({
        invoiceId: invoice.id,
        amount: numAmount,
        paymentMethod: method,
        bankName: bankName.trim() || undefined,
        referenceNumber: reference.trim() || undefined,
        appliedTo: invoice.paidAmount === 0 ? "DP" : "FINAL_BALANCE",
        notes: notes.trim() || undefined,
        verified: true, // auto-verified by admin
      });

      if (!res.success) {
        setErrorMessage(res.error || "Gagal mencatat pembayaran.");
        return;
      }

      onSuccess();
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md sm:rounded-[28px] p-6">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-[#09090b]">
            Catat Pembayaran Klien
          </DialogTitle>
          <DialogDescription className="text-xs text-[#71717a]">
            Invoice: <strong className="text-[#09090b]">{invoice.invoiceNumber}</strong> · {invoice.customerName}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="mt-3 space-y-4">
          <div className="rounded-[16px] bg-[#fafafa] p-3.5 border border-[#ececee] text-xs space-y-1">
            <div className="flex justify-between text-[#71717a]">
              <span>Total Kontrak:</span>
              <span className="font-mono font-semibold text-[#09090b]">{formatIDR(invoice.grossAmount)}</span>
            </div>
            <div className="flex justify-between text-[#71717a]">
              <span>Sudah Dibayar:</span>
              <span className="font-mono text-[#09090b]">{formatIDR(invoice.paidAmount)}</span>
            </div>
            <div className="flex justify-between text-[#ff5a00] font-bold border-t border-[#ececee] pt-1 mt-1">
              <span>Sisa Tagihan:</span>
              <span className="font-mono">{formatIDR(invoice.balanceDue)}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
              Nominal Diterima (Rp) <span className="text-[#ff5a00]">*</span>
            </label>
            <input
              type="number"
              required
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-[12px] border border-[#ececee] px-3 py-2 text-sm font-mono text-[#09090b] outline-none focus:border-[#09090b]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                Metode Pembayaran
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as typeof method)}
                className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none"
              >
                <option value="BANK_TRANSFER">Transfer Bank</option>
                <option value="CASH">Tunai / Cash</option>
                <option value="QRIS">QRIS</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
                Bank Penerima
              </label>
              <input
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="BCA / Mandiri"
                className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
              No. Referensi / Bukti Transfer
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Contoh: TRF-20261002-8812"
              className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs font-mono text-[#09090b] outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#52525b] mb-1">
              Catatan Pembayaran
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Pelunasan sewa kamera Sony FX3..."
              className="w-full rounded-[12px] border border-[#ececee] bg-white px-3 py-2 text-xs text-[#09090b] outline-none"
            />
          </div>

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-[12px] border border-[#ff5a00] bg-[#fff6f2] p-2.5 text-xs text-[#ff5a00]">
              <AlertCircle size={14} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#ececee]">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="rounded-[12px] text-xs min-h-10 px-4 border-[#ececee]"
            >
              Batal
            </Button>
            <Button
              type="submit"
              disabled={isPending}
              className="rounded-[12px] text-xs min-h-10 px-5 bg-[#09090b] text-white hover:bg-[#27272a]"
            >
              {isPending ? "Menyimpan…" : "Simpan Kwitansi"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrintDropdownButton({ invoiceId, invoiceNumber }: { invoiceId: string; invoiceNumber: string }) {
  const [open, setOpen] = useState(false);
  const target = encodeURIComponent(invoiceNumber || invoiceId);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 rounded-[10px] border border-[#ececee] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors cursor-pointer"
        title="Opsi Cetak Faktur & Kuitansi"
      >
        <Printer size={13} />
        <span>Cetak</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-48 rounded-[14px] border border-[#ececee] bg-white p-1.5 shadow-xl text-xs space-y-0.5 animate-in fade-in zoom-in-95">
            <a
              href={`/api/admin/invoices/${target}/print?variant=auto`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-[9px] px-2.5 py-1.5 font-medium text-[#09090b] hover:bg-[#fafafa] transition-colors"
            >
              <span>Sesuai Status</span>
              <span className="text-[10px] font-mono text-[#a1a1aa]">Auto</span>
            </a>
            <a
              href={`/api/admin/invoices/${target}/print?variant=dp`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-[9px] px-2.5 py-1.5 font-medium text-[#ff5a00] hover:bg-[#fff6f2] transition-colors"
            >
              <span>Tagihan DP</span>
              <span className="text-[10px] font-mono text-[#ff5a00]/70">DP</span>
            </a>
            <a
              href={`/api/admin/invoices/${target}/print?variant=final`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-[9px] px-2.5 py-1.5 font-medium text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors"
            >
              <span>Tagihan Pelunasan</span>
              <span className="text-[10px] font-mono text-[#a1a1aa]">Sisa</span>
            </a>
            <a
              href={`/api/admin/invoices/${target}/print?variant=receipt`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between rounded-[9px] px-2.5 py-1.5 font-medium text-[#09090b] hover:bg-[#fafafa] transition-colors border-t border-[#ececee]/60 pt-1.5"
            >
              <span className="font-semibold">Kuitansi Lunas</span>
              <span className="text-[10px] font-mono text-emerald-600 font-bold">Lunas</span>
            </a>
          </div>
        </>
      )}
    </div>
  );
}
