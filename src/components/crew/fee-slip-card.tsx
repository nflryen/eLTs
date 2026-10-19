"use client";

import {
  Receipt,
  Download,
  CheckCircle,
  Clock,
  Building,
  CreditCard,
  User,
  ExternalLink,
} from "lucide-react";
import type { CrewPaymentStatus } from "@/types/operations";

interface FeeSlipCardProps {
  feeAgreed: number;
  paymentStatus: CrewPaymentStatus;
  paidAt: string | null;
  paymentReceiptUrl: string | null;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  crewName: string;
  crewCode: string;
  projectName: string;
  roleTitle: string;
}

export function FeeSlipCard({
  feeAgreed,
  paymentStatus,
  paidAt,
  paymentReceiptUrl,
  bankName,
  bankAccountNumber,
  bankAccountHolder,
  crewName,
  crewCode,
  projectName,
  roleTitle,
}: FeeSlipCardProps) {
  const formattedFee = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(feeAgreed);

  const formattedPaidAt = paidAt
    ? new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(paidAt))
    : null;

  const handlePrint = () => {
    window.print();
  };

  const getStatusBadge = () => {
    switch (paymentStatus) {
      case "PAID":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#09090b] text-white border border-[#09090b]">
            <CheckCircle className="size-3.5" />
            LUNAS
          </span>
        );
      case "PARTIAL":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#ff5a00]/12 text-[#ff5a00] border border-[#ff5a00]/40">
            <Clock className="size-3.5" />
            DIBAYAR SEBAGIAN
          </span>
        );
      case "UNPAID":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#a1a1aa]/20 text-[#52525b] border border-[#d4d4d8]">
            <Clock className="size-3.5" />
            PENDING
          </span>
        );
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm print:border-none print:shadow-none">
      <div className="flex items-center justify-between border-b border-border/80 pb-4 mb-5">
        <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          <Receipt className="size-4 text-foreground" />
          <span>Slip Honor & Remunerasi Produksi</span>
        </div>
        <div>{getStatusBadge()}</div>
      </div>

      {/* Fee Display Banner */}
      <div className="bg-secondary/40 border border-border/70 rounded-xl p-5 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Nominal Honor Disepakati
          </p>
          <p className="text-2xl sm:text-3xl font-serif font-bold text-foreground mt-0.5 tracking-tight">
            {formattedFee}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Penugasan: <span className="text-foreground font-medium">{roleTitle}</span>
          </p>
        </div>

        <button
          onClick={handlePrint}
          type="button"
          className="inline-flex items-center justify-center gap-2 px-4 min-h-11 bg-background border border-border rounded-lg text-xs font-medium text-foreground hover:bg-secondary/80 transition-colors shrink-0 print:hidden shadow-xs cursor-pointer"
        >
          <Download className="size-3.5" />
          <span>Cetak / Simpan PDF</span>
        </button>
      </div>

      {/* Payment Meta & Bank Account */}
      <div className="space-y-3.5">
        {bankAccountNumber ? (
          <div className="p-4 rounded-lg bg-secondary/20 border border-border/60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
              Rekening Tujuan Transfer
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Building className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">Bank:</span>
                <span className="font-semibold text-foreground uppercase">{bankName}</span>
              </div>
              <div className="flex items-center gap-2">
                <CreditCard className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">No. Rek:</span>
                <span className="font-mono font-semibold text-foreground">{bankAccountNumber}</span>
              </div>
              <div className="flex items-center gap-2">
                <User className="size-3.5 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">A.N:</span>
                <span className="font-semibold text-foreground">{bankAccountHolder}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-lg bg-secondary/20 border border-border/60 text-xs text-muted-foreground flex items-center gap-2">
            <CreditCard className="size-4 shrink-0 text-muted-foreground" />
            <span>Pencairan dana ditransfer via rekening bank terdaftar di sistem pusat studio.</span>
          </div>
        )}

        {/* Settlement Notes */}
        {paymentStatus === "PAID" ? (
          <div className="p-3.5 rounded-lg bg-[#09090b]/5 border border-[#09090b]/25 text-xs text-[#09090b] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <p className="font-semibold">Remunerasi Telah Ditransfer</p>
              {formattedPaidAt && (
                <p className="text-[11px] text-[#52525b] mt-0.5">
                  Diproses pada {formattedPaidAt}
                </p>
              )}
            </div>
            {paymentReceiptUrl && (
              <a
                href={paymentReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 min-h-11 text-xs font-semibold text-[#09090b] hover:underline"
              >
                <span>Lihat Bukti Transfer</span>
                <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        ) : (
          <div className="p-3.5 rounded-lg bg-secondary/30 border border-border/60 text-xs text-muted-foreground">
            <p className="leading-relaxed">
              Honor akan dicairkan oleh bagian keuangan studio setelah sesi produksi selesai dan seluruh file media diverifikasi di Drop Vault.
            </p>
          </div>
        )}
      </div>

      {/* Printable Footer / Metadata */}
      <div className="mt-5 pt-4 border-t border-border/60 text-[11px] text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 print:flex">
        <span>ID Kru: {crewCode} • {crewName}</span>
        <span>Proyek: {projectName}</span>
      </div>
    </div>
  );
}
