"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Clock,
  Calendar,
  MapPin,
  CreditCard,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  Briefcase,
  AlertCircle,
} from "lucide-react";
import { respondToAssignmentOfferAction } from "@/app/actions/crew-consent";

export interface OfferAcceptanceCardProps {
  magicToken: string;
  roleTitle: string;
  projectName: string;
  servicePillar: string;
  shootDate: string | null;
  callTime: string;
  rollTime?: string | null;
  venueName: string;
  venueAddress: string;
  venueMapsUrl?: string | null;
  feeAgreed: number;
  bankName?: string;
  bankAccountNumber?: string;
  bankAccountHolder?: string;
  crewMemberName?: string;
}

const COMMON_DECLINE_REASONS = [
 "Bentrok jadwal produksi lain",
 "Lokasi venue di luar jangkauan operasional",
 "Kondisi kesehatan sedang kurang prima",
 "Perlengkapan teknis utama sedang servis",
 "Lainnya",
];

export function OfferAcceptanceCard({
  magicToken,
  roleTitle,
  projectName,
  servicePillar,
  shootDate,
  callTime,
  rollTime,
  venueName,
  venueAddress,
  venueMapsUrl,
  feeAgreed,
  bankName,
  bankAccountNumber,
  bankAccountHolder,
  crewMemberName,
}: OfferAcceptanceCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
 const [actionType, setActionType] = useState<"ACCEPT" | "DECLINE" | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
 type: "success" | "error";
    text: string;
  } | null>(null);

  // Decline Modal State
  const [isDeclineModalOpen, setIsDeclineModalOpen] = useState(false);
 const [selectedQuickReason, setSelectedQuickReason] = useState("");
 const [customDeclineReason, setCustomDeclineReason] = useState("");
  const [declineError, setDeclineError] = useState<string | null>(null);

  const formatDateTime = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
 return new Intl.DateTimeFormat("id-ID", {
 weekday: "long",
 day: "numeric",
 month: "long",
 year: "numeric",
      }).format(date);
    } catch {
      return dateStr;
    }
  };

  const formatTimeOnly = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
 return new Intl.DateTimeFormat("id-ID", {
 hour: "2-digit",
 minute: "2-digit",
        hour12: false,
 timeZoneName: "short",
      }).format(date);
    } catch {
      return timeStr;
    }
  };

 const formattedFee = `Rp ${Number(feeAgreed || 0).toLocaleString("id-ID")}`;

  const mapsHref =
    venueMapsUrl ||
 `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
 `${venueName}, ${venueAddress}`
 )}`;

  // Handle Accept
  const handleAcceptOffer = () => {
    setStatusMessage(null);
 setActionType("ACCEPT");

    startTransition(async () => {
      try {
        const res = await respondToAssignmentOfferAction(magicToken, true);
        if (res.success) {
          setStatusMessage({
 type: "success",
 text: res.message || "Tugas berhasil diterima! Membuka akses call sheet...",
          });
          router.refresh();
        } else {
          setStatusMessage({
 type: "error",
 text: res.message || res.error || "Gagal memproses persetujuan penugasan.",
          });
        }
      } catch (err: unknown) {
        setStatusMessage({
 type: "error",
 text: err instanceof Error ? err.message : "Terjadi kesalahan saat memproses.",
        });
      } finally {
        setActionType(null);
      }
    });
  };

  // Handle Decline Submission
  const handleConfirmDecline = () => {
 const finalReason = customDeclineReason.trim() || selectedQuickReason || "Bentrok jadwal";
    setDeclineError(null);
 setActionType("DECLINE");

    startTransition(async () => {
      try {
        const res = await respondToAssignmentOfferAction(magicToken, false, finalReason);
        if (res.success) {
          setIsDeclineModalOpen(false);
          setStatusMessage({
 type: "success",
 text: res.message || "Penolakan tugas telah dicatat.",
          });
          router.refresh();
        } else {
 setDeclineError(res.message || res.error || "Gagal memproses penolakan.");
        }
      } catch (err: unknown) {
 setDeclineError(err instanceof Error ? err.message : "Terjadi kesalahan jaringan.");
      } finally {
        setActionType(null);
      }
    });
  };

  return (
    <div className="relative rounded-[36px] border border-[#ececee] bg-white p-6 sm:p-8 overflow-hidden transition-all">
      {/* Accent glow corner */}
      <div className="absolute top-0 right-0 w-48 h-48 bg-[#f4f4f5] rounded-bl-full pointer-events-none" />

      {/* 1. Header Badge */}
 <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#ececee] bg-[#fafafa] text-[#09090b] text-xs font-bold tracking-wide">
 <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#09090b] opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#09090b]"></span>
          </span>
          <span>📩 TAWARAN TUGAS BARU</span>
        </div>
 <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider bg-secondary/80 px-2.5 py-1 rounded-md">
          Dual-Consent Required
        </span>
      </div>

      {/* 2. Core Assignment Overview */}
 <div className="space-y-4 mb-6">
        <div>
 <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
 <Briefcase className="size-3.5" />
 <span>{servicePillar.replace(/_/g, " ")}</span>
          </div>
 <h2 className="font-serif text-2xl sm:text-3xl font-bold text-foreground tracking-tight">
            {roleTitle}
          </h2>
 <p className="text-sm font-medium text-foreground/80 mt-1">
 Proyek: <span className="font-semibold text-foreground">{projectName}</span>
          </p>
          {crewMemberName && (
 <p className="text-xs text-muted-foreground mt-0.5">
 Ditujukan kepada: <span className="font-medium text-foreground">{crewMemberName}</span>
            </p>
          )}
        </div>

        {/* Schedule & Location Matrix */}
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {/* Date & Time */}
 <div className="p-3.5 bg-secondary/40 rounded-xl border border-border/70 space-y-2">
 <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Calendar className="size-4 text-[#52525b] " />
              <span>{shootDate ? formatDateTime(shootDate) : formatDateTime(callTime)}</span>
            </div>
 <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
 <Clock className="size-3.5" />
              <span>
 Call Time: <strong className="text-foreground">{formatTimeOnly(callTime)}</strong>
                {rollTime && (
                  <>
 {" "}• Roll: <strong className="text-foreground">{formatTimeOnly(rollTime)}</strong>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Venue & Location */}
 <div className="p-3.5 bg-secondary/40 rounded-xl border border-border/70 space-y-1.5">
 <div className="flex items-start justify-between gap-2">
 <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
              <MapPin className="size-4 text-[#52525b] shrink-0" />
 <span className="truncate">{venueName}</span>
              </div>
              <a
                href={mapsHref}
 target="_blank"
 rel="noopener noreferrer"
                className="text-[11px] font-semibold text-[#09090b] hover:underline shrink-0 inline-flex items-center gap-0.5"
              >
 Maps <ExternalLink className="size-3" />
              </a>
            </div>
 <p className="text-xs text-muted-foreground pl-6 line-clamp-2 leading-relaxed">
              {venueAddress}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Big Offered Fee Card */}
      <div className="mb-6 p-5 sm:p-6 rounded-[12px] border border-[#ececee] bg-[#fafafa]">
 <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#52525b] ">
              Total Penawaran Honor Kru
            </p>
 <div className="font-serif text-3xl sm:text-4xl font-extrabold text-foreground mt-1 tracking-tight">
              {formattedFee}
            </div>
          </div>
 <div className="sm:text-right">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#ececee] bg-[#fafafa] text-[#09090b] text-xs font-semibold">
 <CreditCard className="size-3.5" />
              <span>Standard Production Fee</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3.5 border-t border-[#ececee] text-xs text-[#52525b] leading-relaxed flex items-start gap-2">
          <ShieldCheck className="size-4 text-[#52525b] shrink-0 mt-0.5" />
          <p>
            {bankName && bankAccountNumber ? (
              <>
 Honor produksi akan ditransfer pasca-produksi (H+1 selesai produksi) ke rekening terdaftar:{" "}
 <strong className="text-foreground">{bankName} {bankAccountNumber}</strong>
 {bankAccountHolder ? ` a/n ${bankAccountHolder}` : ""}.
              </>
            ) : (
              <>
                Honor produksi akan ditransfer pasca-produksi (H+1 selesai produksi) ke rekening bank terdaftar Anda di database studio ELTS.
              </>
            )}
          </p>
        </div>
      </div>

      {/* 4. Readiness Declaration Text */}
      <div className="mb-6 p-4 rounded-[12px] border border-[#ececee] bg-[#fafafa]">
        <div className="flex items-start gap-3">
          <div className="p-1 rounded-[12px] bg-[#f4f4f5] text-[#3f3f46] shrink-0 mt-0.5">
 <ShieldCheck className="size-4" />
          </div>
 <div className="space-y-1">
 <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
              Pernyataan Kesiapan & Komitmen Operasional
            </p>
 <p className="text-xs text-muted-foreground leading-relaxed">
              Dengan menerima tawaran ini, saya menyatakan bersedia hadir tepat waktu di lokasi sesuai Call Time, membawa perlengkapan yang dialokasikan dalam kondisi siap pakai, mematuhi dress code serta standar operasional ELTS Studio.
            </p>
          </div>
        </div>
      </div>

      {/* Status Feedback Message */}
      {statusMessage && (
        <div
 className={`mb-6 p-4 rounded-xl text-xs flex items-start gap-3 border ${
 statusMessage.type === "success"
                ? "bg-[#09090b]/5 border-[#09090b]/30 text-[#09090b] "
                  : "bg-[#ff5a00]/10 border-[#ff5a00]/50 text-[#ff5a00] "
 }`}
        >
 {statusMessage.type === "success" ? (
 <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          ) : (
 <AlertCircle className="size-4 shrink-0 mt-0.5" />
          )}
 <span className="font-medium leading-relaxed">{statusMessage.text}</span>
        </div>
      )}

      {/* 5. Action Buttons */}
 <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        {/* Accept Button */}
        <button
 type="button"
          onClick={handleAcceptOffer}
          disabled={isPending}
          className="flex-1 min-h-12 inline-flex items-center justify-center gap-2 px-6 rounded-[14px] bg-[#09090b] hover:bg-[#27272a] active:bg-[#09090b] text-white font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
 {isPending && actionType === "ACCEPT" ? (
            <>
 <Loader2 className="size-4 animate-spin" />
              <span>Memproses Persetujuan...</span>
            </>
          ) : (
            <>
 <Check className="size-4 stroke-[3]" />
              <span>TERIMA TUGAS INI</span>
            </>
          )}
        </button>

        {/* Decline Button */}
        <button
 type="button"
          onClick={() => {
            setDeclineError(null);
            setIsDeclineModalOpen(true);
          }}
          disabled={isPending}
          className="min-h-12 inline-flex items-center justify-center gap-2 px-5 rounded-[14px] border border-[#ececee] text-[#52525b] hover:bg-[#fafafa] active:bg-[#f4f4f5] font-semibold text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
 <X className="size-4" />
          <span>Tolak Tugas</span>
        </button>
      </div>

      {/* 6. Decline Reason Modal */}
      {isDeclineModalOpen && (
 <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-lg rounded-[36px] border border-[#ececee] bg-white p-6 sm:p-7 space-y-5"
 role="dialog"
 aria-modal="true"
 aria-labelledby="decline-modal-title"
          >
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-center gap-3">
              <div className="size-10 rounded-full border border-[#ececee] bg-[#fafafa] text-[#52525b] flex items-center justify-center shrink-0">
 <AlertTriangle className="size-5" />
                </div>
                <div>
 <h3 id="decline-modal-title" className="font-serif text-lg font-bold text-foreground">
                    Konfirmasi Penolakan Tugas
                  </h3>
 <p className="text-xs text-muted-foreground mt-0.5">
                    Penolakan akan mengembalikan slot kru ke status tidak terisi.
                  </p>
                </div>
              </div>
              <button
 type="button"
                onClick={() => !isPending && setIsDeclineModalOpen(false)}
                className="text-[#52525b] hover:text-[#09090b] p-1 min-h-11 min-w-11 inline-flex items-center justify-center rounded-[12px] cursor-pointer"
              >
 <X className="size-5" />
              </button>
            </div>

            {/* Quick Reasons */}
 <div className="space-y-2">
 <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Pilih Alasan Penolakan:
              </label>
 <div className="flex flex-wrap gap-2">
                {COMMON_DECLINE_REASONS.map((reason) => {
                  const isSelected = selectedQuickReason === reason;
                  return (
                    <button
                      key={reason}
 type="button"
                      onClick={() => {
                        setSelectedQuickReason(reason);
 if (reason !== "Lainnya") {
                          setCustomDeclineReason(reason);
                        } else {
 setCustomDeclineReason("");
                        }
                      }}
                      className={`min-h-11 text-xs px-3 py-1.5 rounded-[12px] border transition-all text-left cursor-pointer ${
                        isSelected
                          ? "bg-[#09090b] border-[#09090b] text-white font-semibold"
                          : "bg-[#fafafa] border-[#ececee] text-[#52525b] hover:text-[#09090b] hover:bg-[#f4f4f5]"
                      }`}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Detailed Notes */}
 <div className="space-y-1.5">
 <label className="text-xs font-medium text-muted-foreground block">
                Catatan Tambahan untuk Studio Coordinator (Opsional):
              </label>
              <textarea
                value={customDeclineReason}
                onChange={(e) => setCustomDeclineReason(e.target.value)}
 placeholder="Contoh: Jadwal bentrok dengan acara keluarga atau proyek komersial lain..."
                rows={3}
                disabled={isPending}
                className="w-full text-xs p-3 rounded-[12px] bg-[#fafafa] border border-[#ececee] focus:border-[#09090b] focus:outline-none transition-colors text-[#09090b] placeholder:text-[#a1a1aa] resize-none"
              />
            </div>

            {/* Decline Error Display */}
            {declineError && (
              <div className="p-3 rounded-[12px] border border-[#ff5a00]/50 bg-[#ff5a00]/10 text-[#ff5a00] text-xs flex items-center gap-2">
 <AlertCircle className="size-4 shrink-0" />
                <span>{declineError}</span>
              </div>
            )}

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#ececee]">
              <button
                type="button"
                onClick={() => setIsDeclineModalOpen(false)}
                disabled={isPending}
                className="min-h-11 px-4 py-2.5 rounded-[14px] text-xs font-semibold text-[#52525b] hover:text-[#09090b] hover:bg-[#fafafa] transition-colors cursor-pointer"
              >
                Batal
              </button>
              <button
 type="button"
                onClick={handleConfirmDecline}
                disabled={isPending}
                className="min-h-11 inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[14px] bg-[#09090b] hover:bg-[#27272a] text-white text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer"
              >
 {isPending && actionType === "DECLINE" ? (
                  <>
 <Loader2 className="size-3.5 animate-spin" />
                    <span>Mencatat Penolakan...</span>
                  </>
                ) : (
                  <>
 <X className="size-3.5" />
                    <span>Konfirmasi Tolak Tugas</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
