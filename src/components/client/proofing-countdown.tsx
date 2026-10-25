"use client";

import { useEffect, useState } from "react";
import { Clock, LockKeyhole, AlertTriangle, Sparkles, CheckCircle2 } from "lucide-react";

interface ProofingCountdownProps {
  deadline: string | null;
  lockedAt: string | null;
  selectedCount: number;
  quotaMin: number;
  quotaMax: number;
}

interface TimeRemaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  totalMs: number;
}

function calculateTimeRemaining(deadlineStr: string | null): TimeRemaining | null {
  if (!deadlineStr) return null;
  const target = new Date(deadlineStr).getTime();
  if (Number.isNaN(target)) return null;

  const now = Date.now();
  const diff = target - now;

  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, totalMs: 0 };
  }

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return { days, hours, minutes, seconds, isExpired: false, totalMs: diff };
}

export function ProofingCountdown({
  deadline,
  lockedAt,
  selectedCount,
  quotaMin,
  quotaMax,
}: ProofingCountdownProps) {
  const [time, setTime] = useState<TimeRemaining | null>(() =>
    calculateTimeRemaining(deadline)
  );

  useEffect(() => {
    if (!deadline || lockedAt) return;

    const interval = setInterval(() => {
      setTime(calculateTimeRemaining(deadline));
    }, 1000);

    return () => clearInterval(interval);
  }, [deadline, lockedAt]);

  const isLocked = Boolean(lockedAt);
  const progressPct = quotaMax > 0 ? Math.min(100, Math.round((selectedCount / quotaMax) * 100)) : 0;

  // 1. Locked State Banner
  if (isLocked) {
    return (
      <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/90 p-4 sm:p-5 text-emerald-950 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-emerald-950">
              Pilihan Foto Telah Dikunci &amp; Masuk Antrean Editing
            </h3>
            <p className="text-xs text-emerald-800/90 mt-0.5">
              {selectedCount} foto terpilih sedang dalam pengerjaan retouching oleh tim editor kami.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-200/80 text-emerald-900 border border-emerald-300">
          <LockKeyhole size={12} /> Terkunci
        </span>
      </div>
    );
  }

  // 2. Active Countdown State
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-800">
            {time?.isExpired ? (
              <AlertTriangle size={18} className="text-amber-600" />
            ) : (
              <Clock size={18} className="text-zinc-900" />
            )}
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-zinc-900">
              {time?.isExpired
                ? "Batas Waktu Pemilihan Foto Telah Berakhir"
                : "Sesi Seleksi Foto Proofing Aktif"}
            </h4>
            <p className="text-[11px] text-zinc-500">
              Target kuota paket: <strong>{quotaMin}–{quotaMax} foto</strong> untuk diedit.
            </p>
          </div>
        </div>

        {/* Countdown Digits */}
        {time && !time.isExpired ? (
          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-zinc-900 bg-zinc-50 border border-zinc-200 px-3 py-1.5 rounded-xl self-start sm:self-auto">
            <span className="text-zinc-400 text-[10px] uppercase mr-1">Sisa:</span>
            {time.days > 0 && (
              <>
                <span className="bg-white px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-900">
                  {time.days}h
                </span>
                <span className="text-zinc-300">:</span>
              </>
            )}
            <span className="bg-white px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-900">
              {String(time.hours).padStart(2, "0")}j
            </span>
            <span className="text-zinc-300">:</span>
            <span className="bg-white px-1.5 py-0.5 rounded border border-zinc-200 text-zinc-900">
              {String(time.minutes).padStart(2, "0")}m
            </span>
            <span className="text-zinc-300">:</span>
            <span className="bg-white px-1.5 py-0.5 rounded border border-zinc-200 text-[#ff5a00]">
              {String(time.seconds).padStart(2, "0")}d
            </span>
          </div>
        ) : time?.isExpired ? (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 self-start sm:self-auto">
            <AlertTriangle size={12} /> Melewati Batas Waktu
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-zinc-500 bg-zinc-50 self-start sm:self-auto">
            <Sparkles size={12} className="text-amber-500" /> Proofing Mandiri
          </span>
        )}
      </div>

      {/* Progress Bar of selection quota */}
      <div className="space-y-1 pt-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">
            Kemajuan seleksi: <strong className="text-zinc-900 font-mono">{selectedCount}</strong> / {quotaMax} foto
          </span>
          <span className={`font-mono font-semibold ${selectedCount >= quotaMin ? "text-emerald-700" : "text-amber-700"}`}>
            {progressPct}%
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-zinc-100 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              selectedCount >= quotaMin ? "bg-emerald-600" : "bg-amber-500"
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
