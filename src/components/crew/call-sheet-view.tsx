"use client";

import { useState, useTransition } from "react";
import {
  MapPin,
  Clock,
  Shirt,
  Calendar,
  ExternalLink,
  CheckCircle2,
  Navigation,
  Loader2,
} from "lucide-react";
import { checkInCrewMember } from "@/app/actions/crew";

interface CallSheetViewProps {
  /** The crew member's magic token — the only credential this portal holds. */
  magicToken: string;
  shootDate: string | null;
  callTime: string;
  rollTime: string | null;
  venueName: string;
  venueAddress: string;
  venueMapsUrl: string | null;
  dressCode: string;
  initialCheckInAt: string | null;
}

export function CallSheetView({
  magicToken,
  shootDate,
  callTime,
  rollTime,
  venueName,
  venueAddress,
  venueMapsUrl,
  dressCode,
  initialCheckInAt,
}: CallSheetViewProps) {
  const [checkInAt, setCheckInAt] = useState<string | null>(initialCheckInAt);
  const [isPending, startTransition] = useTransition();
  const [checkInError, setCheckInError] = useState<string | null>(null);

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

  const formatTime = (timeStr: string) => {
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

  const mapsHref =
    venueMapsUrl ||
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${venueName}, ${venueAddress}`
    )}`;

  const handleCheckIn = () => {
    setCheckInError(null);
    startTransition(async () => {
      const res = await checkInCrewMember(magicToken);
      if (res.success && res.checkInAt) {
        setCheckInAt(res.checkInAt);
      } else {
        setCheckInError(res.error || "Gagal melakukan check-in. Silakan coba lagi.");
      }
    });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-6 sm:p-7 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/80 pb-4 mb-5">
        <div className="flex items-center gap-2.5 text-xs font-semibold tracking-wider uppercase text-muted-foreground">
          <Calendar className="size-4 text-foreground" />
          <span>Call Sheet & Jadwal Lapangan</span>
        </div>
        {shootDate && (
          <span className="text-xs font-medium text-foreground bg-secondary px-2.5 py-1 rounded-md">
            {formatDateTime(shootDate)}
          </span>
        )}
      </div>

      {/* Time Badges */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        <div className="bg-[#ff5a00]/10 border border-[#ff5a00]/30 rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#ff5a00] mb-1">
            <Clock className="size-3.5" />
            <span>Call Time (Wajib Hadir)</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold tracking-tight text-[#09090b]">
            {formatTime(callTime)}
          </p>
          <p className="text-[11px] text-[#52525b] mt-0.5">Tiba di lokasi & persiapan alat</p>
        </div>

        <div className="bg-secondary/70 border border-border rounded-lg p-3.5 sm:p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1">
            <Clock className="size-3.5" />
            <span>Roll Time (Mulai Rekam)</span>
          </div>
          <p className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            {rollTime ? formatTime(rollTime) : "—"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Kickoff rangkaian acara</p>
        </div>
      </div>

      {/* Venue Section */}
      <div className="space-y-4 mb-6">
        <div className="rounded-lg bg-secondary/30 p-4 border border-border/60">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-background border border-border rounded-md shrink-0 text-foreground">
              <MapPin className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-foreground leading-snug">
                {venueName}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                {venueAddress}
              </p>
            </div>
          </div>

          <div className="mt-3.5 pt-3 border-t border-border/60 flex items-center justify-between">
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-11 text-xs font-medium text-[#09090b] hover:underline"
            >
              <Navigation className="size-3.5" />
              <span>Buka Petunjuk Arah (Google Maps)</span>
              <ExternalLink className="size-3 opacity-70" />
            </a>
          </div>
        </div>

        {/* Dress Code */}
        <div className="flex items-center gap-3 p-3.5 bg-secondary/30 rounded-lg border border-border/60">
          <div className="p-2 bg-background border border-border rounded-md shrink-0 text-foreground">
            <Shirt className="size-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Dress Code & Penampilan
            </p>
            <p className="text-xs font-medium text-foreground mt-0.5">
              {dressCode || "Seragam Hitam / Studio Polo"}
            </p>
          </div>
        </div>
      </div>

      {/* Check-In Action Section */}
      <div className="border-t border-border/80 pt-5">
        {checkInAt ? (
          <div className="flex items-center gap-3 rounded-lg bg-[#09090b]/5 border border-[#09090b]/25 p-3.5 sm:p-4 text-[#09090b]">
            <CheckCircle2 className="size-5 shrink-0 text-[#09090b]" />
            <div>
              <p className="text-xs font-semibold">Tiba di Lokasi & Terverifikasi</p>
              <p className="text-[11px] text-[#52525b] mt-0.5">
                Check-in terekam pada {formatTime(checkInAt)}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={handleCheckIn}
              disabled={isPending}
              className="w-full min-h-12 flex items-center justify-center gap-2 bg-[#09090b] text-white hover:bg-[#27272a] rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 active:scale-[0.99] cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Memverifikasi Lokasi...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Saya Sudah Tiba di Lokasi</span>
                </>
              )}
            </button>
            {checkInError && (
              <p className="text-xs text-[#ff5a00] text-center mt-1">{checkInError}</p>
            )}
            <p className="text-[11px] text-muted-foreground text-center">
              Tekan tombol di atas saat tiba di lokasi untuk notifikasi otomatis ke tim koordinator studio.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
