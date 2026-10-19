"use client";

import { useState, useMemo } from "react";
import {
  Printer,
  Copy,
  Check,
  Send,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  ShieldCheck,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StudioLogo } from "@/components/ui/studio-logo";
import type { ClientInvoiceDTO } from "@/types/invoices";

interface ClientInvoiceViewProps {
  invoice: ClientInvoiceDTO;
}

function formatIDR(amount: number): string {
  return `Rp ${Math.round(Number(amount) || 0).toLocaleString("id-ID")}`;
}

function formatDate(dateStr: string | null | undefined): string {
 if (!dateStr) return "-";
  try {
 return new Intl.DateTimeFormat("id-ID", {
 day: "numeric",
 month: "long",
 year: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function ClientInvoiceView({ invoice }: ClientInvoiceViewProps) {
  const [copied, setCopied] = useState(false);

  // Dynamic calculation safeguards
  const lineItemsSum = useMemo(() => {
    return (invoice.line_items ?? []).reduce(
      (acc, item) =>
        acc +
        (Number(item.subtotal) ||
          (Number(item.quantity) || 1) * (Number(item.duration_days) || 1) * (Number(item.unit_price) || 0)),
      0
    );
  }, [invoice.line_items]);

  const contractTotal =
    Number(invoice.gross_contract_value || invoice.contract_value || 0) || lineItemsSum;
  const paidTotal = Number(invoice.paid_amount ?? 0);
  const dpValue =
    Number(invoice.dp_amount || invoice.minimum_dp_required || 0) ||
    Math.round(contractTotal * 0.3);
  const balanceDueValue =
    invoice.final_balance_amount !== undefined && invoice.final_balance_amount !== null
      ? Number(invoice.final_balance_amount)
      : invoice.balance_due !== undefined && invoice.balance_due !== null
      ? Number(invoice.balance_due)
      : Math.max(0, contractTotal - paidTotal);

  /*
   * Payment details come from the invoice DTO, which is populated from
   * `public.studio_payment_methods`. This template previously hardcoded two
   * account numbers, so changing the studio's bank still sent clients the old
   * ones. When no account is configured the message asks the client to contact
   * the studio rather than quoting an account that may be stale.
   */
  const bankLines = (invoice.studio_bank_details ?? [])
    .filter((b) => b.bank && b.account_number)
    .map(
      (b) =>
        `• ${b.bank}: ${b.account_number} a.n. ${b.account_holder ?? "-"}`,
    );

  const paymentBlock =
    bankLines.length > 0
      ? `Rekening Pembayaran:\n${bankLines.join("\n")}`
      : "Rekening pembayaran belum tersedia. Silakan hubungi studio untuk detail pembayaran.";

  // Formatted WhatsApp copy message
  const waPhone = invoice.customer?.phone
    ? invoice.customer.phone.replace(/[^0-9]/g, "").replace(/^0/, "62")
    : "";
  const handleCopyWhatsApp = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://elts.id";
    const invoiceUrl = `${origin}/invoice/${encodeURIComponent(invoice.invoice_number)}`;

    const text = `Halo Bapak/Ibu *${invoice.customer.name}*,\nBerikut kami sampaikan rincian tagihan resmi dari *ELTS Creative & Digital Studio*:\n\n📋 *Proyek / Layanan:* ${invoice.project.name}\n🧾 *No. Invoice:* ${invoice.invoice_number}\n📅 *Jatuh Tempo:* ${formatDate(invoice.due_date)}\n\n💰 *Total Kontrak:* ${formatIDR(contractTotal)}\n${
      paidTotal > 0
        ? `✅ *Terbayar:* ${formatIDR(paidTotal)}\n⏳ *Sisa Pelunasan:* ${formatIDR(balanceDueValue)}`
        : `💳 *Termin Down Payment (DP):* ${formatIDR(dpValue)}`
    }\n\n${paymentBlock}\n\n📄 Unduh / Cetak Invoice Resmi:\n${invoiceUrl}\n\nTerima kasih atas kerja samanya! 🙏`;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const isPaid = invoice.payment_status === "PAID_IN_FULL" || (balanceDueValue <= 0 && contractTotal > 0);
  const isPartiallyPaid = invoice.payment_status === "PARTIALLY_PAID_DP" || (paidTotal > 0 && balanceDueValue > 0);
  const isUnpaid = !isPaid && !isPartiallyPaid;
  return (
 <div className="max-w-4xl mx-auto px-4 print:px-0">
      {/* 1. Action Toolbar (Hidden in Print Mode) */}
    <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-white border border-[#ececee] rounded-[20px] shadow-xs print:hidden">
 <div className="flex items-center gap-2">
          <span className="inline-flex min-h-11 items-center text-xs font-mono font-semibold px-2.5 rounded-full bg-[#fafafa] text-[#52525b] tabular-nums ">
            {invoice.invoice_number}
          </span>
 <span className="text-xs text-muted-foreground">• Dokumen Tagihan Komersial Resmi</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyWhatsApp}
            className="text-xs gap-1.5 min-h-10 text-[#52525b] border-[#ececee] hover:bg-[#fafafa] cursor-pointer"
          >
            {copied ? <Check size={14} className="text-[#09090b]" /> : <Copy size={14} />}
            <span>{copied ? "Tersalin!" : "Salin WhatsApp"}</span>
          </Button>

          {/* Print Variant Direct Links */}
          <div className="inline-flex rounded-[12px] border border-[#ececee] bg-white p-0.5 text-xs font-semibold">
            <a
              href={`/api/admin/invoices/${encodeURIComponent(invoice.invoice_number)}/print?variant=dp`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-[10px] text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors"
            >
              Cetak DP
            </a>
            <a
              href={`/api/admin/invoices/${encodeURIComponent(invoice.invoice_number)}/print?variant=final`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-[10px] text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors"
            >
              Pelunasan
            </a>
            <a
              href={`/api/admin/invoices/${encodeURIComponent(invoice.invoice_number)}/print?variant=receipt`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1.5 rounded-[10px] text-[#52525b] hover:bg-[#fafafa] hover:text-[#09090b] transition-colors"
            >
              Kuitansi
            </a>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={() => window.print()}
            className="inline-flex min-h-10 items-center bg-[#09090b] hover:bg-[#27272a] text-white text-xs gap-1.5 px-3.5 rounded-[12px] cursor-pointer font-semibold"
          >
            <Printer size={14} /> Cetak
          </Button>
        </div>
      </div>

      {/* 2. Official Printable Invoice Paper Sheet */}
      <div className="bg-white text-[#09090b] border border-[#ececee] shadow-xl print:shadow-none print:border-none rounded-[20px] print:rounded-none p-6 sm:p-8 print:p-0 space-y-4 print:space-y-2.5 font-sans">
        {/* Studio Branding & Invoice Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[#ececee] pb-4 print:pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <StudioLogo className="h-8.5 w-auto text-[#09090b]" />
            </div>
            <p className="text-xs text-[#52525b] font-medium leading-tight">Moving Stories, Building Futures.</p>
            <p className="text-[11px] text-[#71717a] mt-1 leading-tight">
              Purwokerto Utara, Kabupaten Banyumas, Jawa Tengah<br />
              WhatsApp: 0822-3459-0719 • Email: halo@elts.id
            </p>
          </div>

 <div className="sm:text-right space-y-1">
            <h1 className="text-2xl sm:text-3xl font-serif font-bold text-[#09090b] tracking-tight uppercase">
              INVOICE
            </h1>
            <p className="font-mono text-sm font-bold text-[#ff5a00] tabular-nums">
              {invoice.invoice_number}
            </p>
            <div className="text-xs text-[#52525b] pt-1 space-y-0.5">
              <p>Tanggal Terbit: <strong className="text-[#09090b]">{formatDate(invoice.issue_date)}</strong></p>
              <p>Jatuh Tempo: <strong className="text-[#09090b]">{formatDate(invoice.due_date)}</strong></p>
            </div>
          </div>
        </div>

        {/* Stakeholder Info & Project Context */}
        <div className="grid sm:grid-cols-2 gap-6 p-5 bg-[#fafafa] rounded-[16px] border border-[#ececee] text-xs">
          <div>
            <span className="text-[10px] font-mono text-[#a1a1aa] font-bold uppercase tracking-wider block mb-1">
              DITAGIHKAN KEPADA:
            </span>
            <p className="font-bold text-[#09090b] text-sm">
              {invoice.customer.name}
            </p>
            <p className="text-[#52525b] mt-0.5">
 WhatsApp: {invoice.customer.phone || "-"}
            </p>
            <p className="text-[#52525b]">
 Email: {invoice.customer.email || "-"}
            </p>
          </div>

 <div className="sm:text-right">
            <span className="text-[10px] font-mono text-[#a1a1aa] font-bold uppercase tracking-wider block mb-1">
              PROYEK / ACARA:
            </span>
            <p className="font-bold text-[#09090b] text-sm">
              {invoice.project.name}
            </p>
            <p className="text-[#52525b] mt-0.5">
              Pilar: {invoice.project.service_pillar}
            </p>
            <p className="text-[#52525b]">
              Tanggal Event: {formatDate(invoice.project.shoot_date)}
            </p>
          </div>
        </div>

        {/* Commercial Line Items Table */}
 <div className="overflow-x-auto">
 <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b-2 border-[#09090b] bg-[#fafafa] text-[#52525b] font-bold">
 <th className="py-3 px-3 w-10 text-center">No</th>
 <th className="py-3 px-4">Deskripsi Layanan Komersial</th>
 <th className="py-3 px-3 text-center w-20">Kuantitas</th>
 <th className="py-3 px-4 text-right">Harga Satuan</th>
 <th className="py-3 px-4 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#ececee]">
              {(invoice.line_items && invoice.line_items.length > 0
                ? invoice.line_items
                : [
                    {
 description: `Layanan Komersial: ${invoice.project.name}`,
                      quantity: 1,
                      unit_price: Number(invoice.gross_contract_value) || 0,
                      subtotal: Number(invoice.gross_contract_value) || 0,
                    },
                  ]
              ).map((item, idx) => (
                <tr key={idx} className="hover:bg-[#fafafa]/50">
                  <td className="py-3.5 px-3 text-center font-mono text-[#a1a1aa] tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="py-3.5 px-4 font-semibold text-[#09090b] leading-snug">
                    <p>{item.description}</p>
                    {item.duration_days && item.duration_days > 1 ? (
                      <span className="inline-block mt-0.5 text-[10px] font-mono text-[#71717a]">
                        Durasi: {item.duration_days} hari
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 print:py-1.5 px-3 text-center font-mono font-medium tabular-nums">
                    {item.quantity}
                  </td>
                  <td className="py-2 print:py-1.5 px-4 text-right font-mono text-[#52525b] tabular-nums">
                    {formatIDR(item.unit_price)}
                  </td>
                  <td className="py-2 print:py-1.5 px-4 text-right font-mono font-bold text-[#09090b] tabular-nums">
                    {formatIDR(item.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Summary & Payment Progress (Right-aligned) */}
        <div className="border-t-2 border-[#09090b] pt-2">
          <div className="max-w-xs ml-auto space-y-1.5 text-xs font-mono">
            <div className="flex items-center justify-between text-[#52525b]">
              <span>TOTAL NILAI KONTRAK:</span>
              <span className="font-bold text-xs text-[#09090b] tabular-nums">
                {formatIDR(contractTotal)}
              </span>
            </div>

            <div className="flex items-center justify-between bg-[#fafafa] p-1.5 rounded-[8px] border border-[#ececee]">
              <span>
                DOWN PAYMENT (DP):
                {invoice.dp_paid_at && <span className="block text-[10px] text-[#52525b] tabular-nums">Lunas: {formatDate(invoice.dp_paid_at)}</span>}
              </span>
              <span className="font-bold tabular-nums">
                (-) {formatIDR(dpValue)}
              </span>
            </div>

            <div className="flex items-center justify-between text-[#09090b] font-bold text-xs border-t border-[#ececee] pt-1 bg-[#f4f4f5] p-1.5 rounded-[8px]">
              <span>SISA PELUNASAN:</span>
              <span className="text-sm tabular-nums text-[#ff5a00] font-bold">
                {formatIDR(balanceDueValue)}
              </span>
            </div>
          </div>
        </div>

        {/* Status Pembayaran Full-Width Horizontal Banner */}
        <div className="w-full bg-[#f4f4f5] border border-[#ececee] rounded-[14px] p-3 mb-2 flex items-center justify-between gap-4">
          <div className="max-w-[70%]">
            <span className="text-[10px] tracking-wider uppercase font-semibold text-[#71717a] block mb-0.5">
              STATUS PEMBAYARAN:
            </span>
            <p className="text-xs text-[#18181b] leading-relaxed whitespace-normal">
              {isPaid
                ? "Pembayaran lunas 100%. Seluruh hak akses unduhan master resolusi tinggi telah dibuka."
                : isPartiallyPaid
                ? "Down Payment (DP) telah terverifikasi lunas. Pelunasan sisa tagihan diselesaikan sebelum unit/master diserahterimakan."
                : "Tagihan menunggu pembayaran termin awal untuk mengunci jadwal sewa alat atau produksi studio."}
            </p>
          </div>
          <div className="shrink-0 flex items-center">
            {isPaid && (
              <div className="px-4 py-2 rounded-[12px] bg-[#09090b] text-white border-2 border-[#09090b] font-mono font-extrabold text-xs uppercase tracking-wider text-center rotate-[-3deg] shadow-xs">
                ✓ LUNAS (100%)
              </div>
            )}
            {isPartiallyPaid && (
              <div className="px-4 py-2 rounded-[12px] bg-[#fafafa] text-[#ff5a00] border-2 border-[#ff5a00]/70 font-mono font-extrabold text-xs uppercase tracking-wider text-center rotate-[-2deg] shadow-xs">
                DP TERBAYAR · SISA PELUNASAN
              </div>
            )}
            {isUnpaid && (
              <div className="px-4 py-2 rounded-[12px] bg-[#fff6f2] text-[#ff5a00] border-2 border-[#ff5a00] font-mono font-extrabold text-xs uppercase tracking-wider text-center rotate-[2deg] shadow-xs">
                MENUNGGU DP (30%)
              </div>
            )}
          </div>
        </div>
        {/* Studio Bank Accounts & Payment Instructions */}
        <div className="pt-4 border-t border-[#ececee] grid sm:grid-cols-2 gap-4 text-xs">
 <div className="space-y-2">
              {(invoice.studio_bank_details ?? []).length > 0 ? (
                invoice.studio_bank_details.map((b) => (
                  <div
                    key={`${b.bank}-${b.account_number}`}
                    className="p-3 bg-[#fafafa] rounded-[16px] border border-[#ececee] space-y-1 font-mono"
                  >
                    <p className="font-bold text-[#09090b]">{b.bank}</p>
                    <p className="text-sm font-extrabold text-[#09090b] tracking-wider tabular-nums">
                      {b.account_number}
                    </p>
                    <p className="text-[11px] text-[#52525b]">
                      a.n. {b.account_holder ?? "-"}
                    </p>
                  </div>
                ))
              ) : (
                /*
                 * Honest empty state. Never render a placeholder account:
                 * a client acting on a stale or invented number loses money.
                 */
                <div className="p-3 bg-[#fafafa] rounded-[16px] border border-dashed border-[#d4d4d8] space-y-1">
                  <p className="font-bold text-[#09090b]">
                    Detail pembayaran belum tersedia
                  </p>
                  <p className="text-[11px] text-[#52525b] leading-relaxed">
                    Silakan hubungi studio melalui WhatsApp untuk memperoleh
                    informasi rekening pembayaran yang berlaku.
                  </p>
                </div>
              )}
          </div>

          <div className="space-y-2 text-[#52525b] leading-relaxed text-[11px]">
            <span className="text-[10px] font-mono font-bold text-[#a1a1aa] uppercase tracking-wider block">
              CATATAN KETENTUAN LAYANAN:
            </span>
 <ul className="list-disc pl-4 space-y-1">
              <li>Pembayaran termin Down Payment (DP) tidak dapat dikembalikan jika terjadi pembatalan sepihak dari pihak klien.</li>
              <li>Pelunasan sisa tagihan wajib diselesaikan maksimal saat serah terima karya final atau sebelum pengunduhan master resolusi tinggi.</li>
              <li>Kirimkan bukti transfer pembayaran melalui kontak WhatsApp resmi studio untuk verifikasi instan.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
