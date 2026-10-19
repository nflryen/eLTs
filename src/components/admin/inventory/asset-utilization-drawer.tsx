"use client";

import React, { useState, useEffect, useMemo, useTransition, use } from "react";
import Link from "next/link";
import {
  X,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  Building,
  Users,
  Store,
  Camera,
  Radio,
  Tv,
  Mic2,
  Headphones,
  Sun,
  Cable,
  Wrench,
  Package,
  ShieldCheck,
  AlertCircle,
  Clock,
  Loader2,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAssetUtilization, toggleOutgoingRental } from "@/app/actions/admin-inventory";
import type {
  AssetCategory,
  ConditionStatus,
  InventoryAssetRow,
} from "@/types/inventory";

export interface AssetBooking {
  project_id: string;
  project_name: string;
  service_pillar: string;
  shoot_date: string;
  status?: string;
  quantity: number;
  total_cost?: number;
  return_status?: string;
}

export interface AssetUtilizationData {
  asset?: Partial<InventoryAssetRow>;
  bookings?: AssetBooking[];
}

export interface AssetUtilizationDrawerProps {
  asset: InventoryAssetRow | null;
  isOpen: boolean;
  onClose: () => void;
  utilizationData?: AssetUtilizationData | null;
  onToggleOutgoingRental?: (asset: InventoryAssetRow) => void;
}

const CATEGORY_CONFIG: Record<
  AssetCategory,
  { label: string; icon: React.ComponentType<{ size?: number; className?: string }>; badgeClass: string }
> = {
  CAMERA: {
    label: "Kamera",
    icon: Camera,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  LENS: {
    label: "Lensa",
    icon: Layers,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  WIRELESS_VIDEO: {
    label: "Wireless Video",
    icon: Radio,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  BROADCAST_SWITCHER: {
    label: "Switcher / vMix",
    icon: Tv,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  AUDIO: {
    label: "Audio & Mixer",
    icon: Mic2,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  INTERCOM: {
    label: "Intercom Headset",
    icon: Headphones,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  LIGHTING: {
    label: "Lighting",
    icon: Sun,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  SUPPORT_RIG: {
    label: "Tripod & Rig",
    icon: Wrench,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  CABLE_ACCESSORY: {
    label: "Kabel & Aksesori",
    icon: Cable,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
};

const CONDITION_CONFIG: Record<
  ConditionStatus,
  { label: string; badgeClass: string }
> = {
  EXCELLENT: {
    label: "Prima (Like New)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#09090b]",
  },
  GOOD: {
    label: "Baik (Siap Pakai)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#09090b]",
  },
  FAIR: {
    label: "Cukup (Ada Bekas Pakai)",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  },
  MAINTENANCE: {
    label: "Servis / Perbaikan",
    badgeClass: "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]",
  },
  RETIRED: {
    label: "Tidak Aktif",
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#a1a1aa]",
  },
};

function formatIDR(amount: number): string {
 return new Intl.NumberFormat("id-ID", {
 style: "currency",
 currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function getPillarBadgeClasses(pillar?: string): string {
  if (!pillar) return "border-[#ececee] bg-[#fafafa] text-[#3f3f46]";
  const p = pillar.toLowerCase();
  // Ember is reserved for the live/broadcast pillar — the one that carries
  // real-time operational risk. Everything else stays achromatic.
  if (p.includes("live") || p.includes("stream") || p.includes("broadcast")) {
    return "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]";
  }
  if (p.includes("lab") || p.includes("digital")) {
    return "border-[#ececee] bg-[#fafafa] text-[#09090b]";
  }
  if (p.includes("wedding")) {
    return "border-[#ececee] bg-[#fafafa] text-[#3f3f46]";
  }
  if (p.includes("commercial") || p.includes("corporate")) {
    return "border-[#ececee] bg-[#fafafa] text-[#3f3f46]";
  }
  return "border-[#ececee] bg-[#fafafa] text-[#52525b]";
}

/**
 * Loads an asset's booking list once. Resolves (never rejects) so the
 * suspended render can branch on `error` instead of tripping an error
 * boundary.
 */
async function fetchBookings(
  assetId: string | undefined,
): Promise<{ list: AssetBooking[]; error: string | null }> {
  if (!assetId) return { list: [], error: null };
  try {
    const res = await getAssetUtilization(assetId);
    if (
      res.success &&
      res.data &&
      typeof res.data === "object" &&
      "bookings" in res.data
    ) {
      return { list: (res.data.bookings as AssetBooking[]) || [], error: null };
    }
    return { list: [], error: res.error || "Gagal memuat jadwal utilisasi aset." };
  } catch (err: unknown) {
    return {
      list: [],
      error: err instanceof Error ? err.message : "Kesalahan sistem",
    };
  }
}
function normalizeDateStr(dateStr?: string | null): string {
 if (!dateStr) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
 if (isNaN(d.getTime())) return "";
  const year = d.getFullYear();
 const month = String(d.getMonth() + 1).padStart(2, "0");
 const day = String(d.getDate()).padStart(2, "0");
 return `${year}-${month}-${day}`;
}

export function AssetUtilizationDrawer({
  asset,
  isOpen,
  onClose,
  utilizationData,
  onToggleOutgoingRental,
}: AssetUtilizationDrawerProps) {
  /*
   * Bookings are derived, not mirrored: `utilizationData.bookings` (when the
   * caller already has them) wins, otherwise we fetch once per asset and unwrap
   * the promise with React 19's `use()`.
   *
   * `use()` is a HOOK — it must be called UNCONDITIONALLY at the top level of
   * the component, never inside a `useMemo`/`useEffect` callback. We therefore
   * always create and suspend on a promise (an already-resolved one when the
   * caller supplied the bookings, so there is no loading flash), and pick the
   * winning list AFTER the hook has run. Loading is "suspended, without caller
   * data, and not yet settled"; the promise never rejects, it resolves with an
   * `error` field instead.
   */
  const propBookings = utilizationData?.bookings;
  const [queriedPromise] = useState(() =>
    propBookings ? Promise.resolve({ list: [], error: null }) : fetchBookings(asset?.id),
  );
  const fetchedBookings = use(queriedPromise);
  const bookings = useMemo<AssetBooking[]>(
    () => propBookings ?? fetchedBookings.list,
    [propBookings, fetchedBookings],
  );
  const loadError = fetchedBookings.error;
  const isLoading = !bookings.length && fetchedBookings.error === null;
  const [isOutgoingAvailable, setIsOutgoingAvailable] = useState<boolean>(
    asset?.is_available_for_outgoing_rental ?? false
  );
  const [isTogglingRental, startToggleTransition] = useTransition();

  // Calendar State: Year & Month
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);

  /*
   * Re-seed the optimistic toggle whenever a different asset is opened. Done
   * during render (React's supported "adjust state on prop change" pattern)
   * rather than in an effect, which would cause an extra cascading render.
   */
  const [syncedAssetId, setSyncedAssetId] = useState(asset?.id ?? null);
  if ((asset?.id ?? null) !== syncedAssetId) {
    setSyncedAssetId(asset?.id ?? null);
    setIsOutgoingAvailable(asset?.is_available_for_outgoing_rental ?? false);
  }

  // Escape key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
 if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
 window.addEventListener("keydown", handleKeyDown);
 return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
 document.body.style.overflow = "hidden";
    } else {
 document.body.style.overflow = "";
    }
    return () => {
 document.body.style.overflow = "";
    };
  }, [isOpen]);

  // Map of booked dates YYYY-MM-DD -> array of bookings
  const bookedDatesRecord = useMemo(() => {
    const record: Record<string, AssetBooking[]> = {};
    for (const b of bookings) {
      const key = normalizeDateStr(b.shoot_date);
      if (key) {
        if (!record[key]) {
          record[key] = [];
        }
        record[key].push(b);
      }
    }
    return record;
  }, [bookings]);

  // Sorted chronological bookings list
  const sortedBookings = useMemo(() => {
    return [...bookings].sort((a, b) => {
      const timeA = new Date(a.shoot_date || 0).getTime();
      const timeB = new Date(b.shoot_date || 0).getTime();
      return timeA - timeB;
    });
  }, [bookings]);

  // Filtered bookings based on calendar click
  const displayBookings = useMemo(() => {
    if (!selectedCalendarDate) return sortedBookings;
    return sortedBookings.filter(
      (b) => normalizeDateStr(b.shoot_date) === selectedCalendarDate
    );
  }, [sortedBookings, selectedCalendarDate]);

  // Days in current calendar month
  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth(); // 0-indexed

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
    // Convert to Monday = 0: (Sunday=0 -> 6, Monday=1 -> 0, etc.)
    const startOffset = (firstDayIndex + 6) % 7;

    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const days: Array<{
      dayNumber: number;
      dateKey: string;
      isCurrentMonth: boolean;
      isToday: boolean;
      bookings: AssetBooking[];
    }> = [];

    const todayKey = normalizeDateStr(new Date().toISOString());

    // Blank padding before 1st day of month
    for (let i = 0; i < startOffset; i++) {
      days.push({
        dayNumber: 0,
 dateKey: `pad-${i}`,
        isCurrentMonth: false,
        isToday: false,
        bookings: [],
      });
    }

    // Days of current month
    for (let day = 1; day <= daysInMonth; day++) {
 const mStr = String(month + 1).padStart(2, "0");
 const dStr = String(day).padStart(2, "0");
 const key = `${year}-${mStr}-${dStr}`;
      const matched = bookedDatesRecord[key] || [];

      days.push({
        dayNumber: day,
        dateKey: key,
        isCurrentMonth: true,
        isToday: key === todayKey,
        bookings: matched,
      });
    }

    return days;
  }, [calendarMonth, bookedDatesRecord]);

  // Toggle Outgoing Rental
  const handleToggleOutgoing = () => {
    if (!asset) return;
    const nextVal = !isOutgoingAvailable;
    setIsOutgoingAvailable(nextVal);

    startToggleTransition(async () => {
      try {
        const res = await toggleOutgoingRental(asset.id, nextVal);
        if (!res.success) {
          // Revert on failure
          setIsOutgoingAvailable(!nextVal);
        } else if (onToggleOutgoingRental) {
          onToggleOutgoingRental({
            ...asset,
            is_available_for_outgoing_rental: nextVal,
          });
        }
      } catch {
        setIsOutgoingAvailable(!nextVal);
      }
    });
  };

  if (!isOpen || !asset) return null;

  const catCfg = CATEGORY_CONFIG[asset.category] || {
    label: asset.category,
    icon: Package,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  };
  const CatIcon = catCfg.icon;

  const condCfg = CONDITION_CONFIG[asset.condition_status] || {
    label: asset.condition_status,
    badgeClass: "border-[#ececee] bg-[#fafafa] text-[#3f3f46]",
  };

 const monthLabel = calendarMonth.toLocaleDateString("id-ID", {
 month: "long",
 year: "numeric",
  });

  // Calculate monthly bookings count
  const currentMonthBookingsCount = calendarDays.reduce(
    (count, d) => (d.isCurrentMonth && d.bookings.length > 0 ? count + 1 : count),
    0
  );

  return (
 <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
 className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
        onClick={onClose}
 aria-hidden="true"
      />

      {/* Slide-over Drawer Panel (520px width) */}
 <div className="fixed inset-y-0 right-0 max-w-full flex">
 <div className="w-screen max-w-[520px] bg-white border-l border-[#ececee] shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
          {/* Header */}
 <div className="p-5 border-b border-[#ececee] bg-[#fafafa]/70 ">
 <div className="flex items-start justify-between gap-4">
 <div className="space-y-1.5 flex-1 min-w-0">
                {/* Badges row */}
 <div className="flex flex-wrap items-center gap-2">
                <span className="rounded border border-[#ececee] bg-[#fafafa] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#09090b]">
                    {asset.asset_code}
                  </span>

                  {/* Category Badge */}
                  <span
 className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md border text-xs font-medium ${catCfg.badgeClass}`}
                  >
                    <CatIcon size={12} />
                    <span>{catCfg.label}</span>
                  </span>

                  {/* Source Badge */}
 {asset.source_type === "IN_HOUSE" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2.5 py-0.5 text-xs font-medium text-[#3f3f46]">
                      <Building size={11} />
                      <span>Milik Studio</span>
                    </span>
                  )}
 {asset.source_type === "PARTNER_OWNED" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2.5 py-0.5 text-xs font-medium text-[#3f3f46]">
                      <Users size={11} />
                      <span>Milik Partner: {asset.owner_name}</span>
                    </span>
                  )}
 {asset.source_type === "VENDOR_RENTAL" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-2.5 py-0.5 text-xs font-medium text-[#c2410c]">
                      <Store size={11} />
                      <span>Vendor Luar: {asset.vendor_name || asset.owner_name}</span>
                    </span>
                  )}
                </div>

                {/* Asset Name */}
 <h2 className="text-lg font-bold text-[#09090b] truncate tracking-tight pt-1">
                  {asset.name}
                </h2>
                {asset.notes && (
 <p className="text-xs text-[#71717a] line-clamp-2">
                    {asset.notes}
                  </p>
                )}
              </div>

              {/* Close Button */}
              <button
 type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg p-3 text-[#a1a1aa] transition-colors hover:bg-[#fafafa] hover:text-[#3f3f46]"
 aria-label="Tutup Drawer"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
 <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Section 1: Physical Specs & Status */}
 <div className="space-y-3">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
 <ShieldCheck size={14} className="text-[#a1a1aa]" />
                Spesifikasi Fisik & Status
              </h3>

 <div className="bg-[#fafafa] border border-[#ececee] rounded-xl p-4 space-y-3.5">
                {/* Row 1: Serial Number & Condition */}
 <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
 <span className="text-[#71717a] block text-[11px]">
                      Nomor Seri (Serial No.)
                    </span>
 <span className="font-mono font-medium text-[#27272a] mt-0.5 block truncate">
 {asset.serial_number || "— (Tidak ada SN)"}
                    </span>
                  </div>

                  <div>
 <span className="text-[#71717a] block text-[11px] mb-1">
                      Kondisi Fisik
                    </span>
                    <span
 className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${condCfg.badgeClass}`}
                    >
                      {condCfg.label}
                    </span>
                  </div>
                </div>

 <div className="h-px bg-[#ececee] " />

                {/* Row 2: Daily Rental Rate & Replacement Value */}
 <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
 <span className="text-[#71717a] block text-[11px]">
                      Tarif Sewa / Hari
                    </span>
 <span className="font-mono font-semibold text-[#09090b] text-sm mt-0.5 block">
                      {Number(asset.daily_rental_rate) > 0
                        ? formatIDR(Number(asset.daily_rental_rate))
 : "Internal Only"}
                    </span>
                  </div>

                  <div>
 <span className="text-[#71717a] block text-[11px]">
                      Nilai Penggantian (Replacement)
                    </span>
 <span className="font-mono font-semibold text-[#09090b] text-sm mt-0.5 block">
                      {Number(asset.replacement_value) > 0
                        ? formatIDR(Number(asset.replacement_value))
 : "—"}
                    </span>
                  </div>
                </div>

 <div className="h-px bg-[#ececee] " />

                {/* Row 3: Outgoing Rental Switch */}
 <div className="flex items-center justify-between pt-1">
                  <div>
 <span className="text-xs font-medium text-[#09090b] block">
                      Ketersediaan Sewa Pihak Luar
                    </span>
 <span className="text-[11px] text-[#71717a] block mt-0.5">
                      {isOutgoingAvailable
 ? "Bisa disewakan ke pihak luar / klien / partner"
 : "Khusus pemakaian internal produksi studio"}
                    </span>
                  </div>

 <div className="flex items-center gap-2">
                    <button
 type="button"
                      disabled={isTogglingRental}
                      onClick={handleToggleOutgoing}
                    className={`relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-[12px] border border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[#18181b] focus-visible:ring-offset-2 disabled:opacity-50 ${
                      isOutgoingAvailable ? "bg-[#09090b]" : "bg-[#a1a1aa]"
                    }`}
                    title={
                      isOutgoingAvailable
                        ? "Status: BISA disewakan ke luar (Klik untuk matikan)"
                        : "Status: KHUSUS internal (Klik untuk aktifkan)"
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        isOutgoingAvailable ? "translate-x-[2px]" : "-translate-x-[2px]"
                      }`}
                    />
                    </button>
                    {isTogglingRental && (
 <Loader2 size={13} className="animate-spin text-[#a1a1aa]" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Section 2: Interactive Monthly Mini-Calendar */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
 <CalendarIcon size={14} className="text-[#a1a1aa]" />
                  Jadwal Utilisasi Kalender
                </h3>

                {currentMonthBookingsCount > 0 ? (
                  <span className="rounded-full border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-2 py-0.5 text-[11px] font-medium text-[#c2410c]">
                    {currentMonthBookingsCount} hari terpakai bulan ini
                  </span>
                ) : (
                  <span className="rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#52525b]">
                    Bebas jadwal bulan ini
                  </span>
                )}
              </div>

 <div className="bg-[#fafafa] border border-[#ececee] rounded-xl p-4 space-y-3">
                {/* Calendar Navigation Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-1.5">
 <span className="text-sm font-bold text-[#09090b] capitalize">
                      {monthLabel}
                    </span>
                    <button
 type="button"
                      onClick={() => {
                        const now = new Date();
                        setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                      }}
                      className="ml-2 inline-flex min-h-11 items-center px-2 text-[11px] text-[#71717a] underline hover:text-[#18181b]"
                    >
                      Bulan ini
                    </button>
                  </div>

 <div className="flex items-center gap-1">
                    <button
 type="button"
                      onClick={() =>
                        setCalendarMonth(
                          new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1)
                        )
                      }
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] text-[#52525b] transition hover:bg-[#fafafa]"
 aria-label="Bulan sebelumnya"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
 type="button"
                      onClick={() =>
                        setCalendarMonth(
                          new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1)
                        )
                      }
                      className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] text-[#52525b] transition hover:bg-[#fafafa]"
 aria-label="Bulan berikutnya"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                {/* Day of Week Headers */}
 <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[#a1a1aa] pb-1 border-b border-[#ececee]/60 ">
                  <div>Sen</div>
                  <div>Sel</div>
                  <div>Rab</div>
                  <div>Kam</div>
                  <div>Jum</div>
                  <div>Sab</div>
                  <div>Min</div>
                </div>

                {/* Days Grid */}
 <div className="grid grid-cols-7 gap-1">
                  {calendarDays.map((cell) => {
                    if (!cell.isCurrentMonth) {
                      return <div key={cell.dateKey} className="h-11" />;
                    }

                    const isBooked = cell.bookings.length > 0;
                    const isSelected = selectedCalendarDate === cell.dateKey;

                    return (
                      <button
                        key={cell.dateKey}
 type="button"
                        onClick={() => {
                          if (isBooked) {
                            setSelectedCalendarDate((prev) =>
                              prev === cell.dateKey ? null : cell.dateKey
                            );
                          }
                        }}
                      className={`relative flex h-11 flex-col items-center justify-center rounded-[12px] font-mono text-xs transition ${
                        isSelected
                          ? "bg-[#09090b] font-bold text-white ring-2 ring-[#18181b] ring-offset-1"
                          : isBooked
                            ? "cursor-pointer border border-[#ff5a00]/30 bg-[#ff5a00]/10 font-bold text-[#c2410c] hover:bg-[#ff5a00]/20"
                            : cell.isToday
                              ? "border border-[#a1a1aa] font-semibold text-[#09090b]"
                              : "text-[#3f3f46] hover:bg-[#fafafa]"
                      }`}
                        title={
                          isBooked
 ? `Terjadwal ${cell.bookings.length} proyek pada ${cell.dateKey}`
                            : cell.dateKey
                        }
                      >
                        <span>{cell.dayNumber}</span>
                        {isBooked && (
                          <span
                          className={`mt-0.5 h-1 w-1 rounded-full ${
                            isSelected ? "bg-white" : "bg-[#ff5a00]"
                          }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Legend & Filter reset */}
 <div className="flex items-center justify-between text-[11px] text-[#71717a] pt-2 border-t border-[#ececee]/60 ">
 <div className="flex items-center gap-3">
 <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded border border-[#ff5a00]/30 bg-[#ff5a00]/10" />
                      Terjadwal Proyek
                    </span>
 <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded border border-[#ececee] bg-[#fafafa]" />
                      Tersedia
                    </span>
                  </div>

                  {selectedCalendarDate && (
                    <button
 type="button"
                      onClick={() => setSelectedCalendarDate(null)}
                      className="inline-flex min-h-11 items-center gap-1 px-2 font-medium text-[#c2410c] hover:underline"
                    >
                      <RotateCcw size={11} />
                      Reset Filter Tanggal
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Section 3: Booked Projects List */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-[#71717a] flex items-center gap-1.5">
 <Clock size={14} className="text-[#a1a1aa]" />
                  Daftar Proyek Terjadwal
                </h3>
                <span className="rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#52525b]">
                  {displayBookings.length} Proyek
                </span>
              </div>

              {isLoading ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-[#a1a1aa]">
                  <Loader2 size={24} className="animate-spin text-[#71717a]" />
                  <p className="text-xs">Memuat kalender utilisasi aset...</p>
                </div>
              ) : loadError ? (
                <div className="flex items-start gap-2 rounded-xl border border-[#ff5a00]/30 bg-[#ff5a00]/10 p-4 text-xs text-[#c2410c]">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">Gagal memuat jadwal</p>
                    <p className="mt-0.5 text-[#ff5a00]">{loadError}</p>
                  </div>
                </div>
              ) : displayBookings.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#ececee] bg-[#fafafa]/50 p-6 text-center">
                  <CheckCircle2 size={24} className="mx-auto mb-1.5 text-[#a1a1aa]" />
 <p className="text-xs font-medium text-[#27272a] ">
                    {selectedCalendarDate
 ? `Tidak ada pemakaian pada tanggal ${selectedCalendarDate}`
 : "Belum ada jadwal penggunaan aset ini"}
                  </p>
 <p className="text-[11px] text-[#71717a] mt-1">
                    {selectedCalendarDate
 ? "Pilih tanggal lain pada kalender atau klik reset filter."
 : "Hardware ini bebas dijadwalkan untuk penugasan shooting proyek baru."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {displayBookings.map((booking, idx) => {
                    const formattedShootDate = booking.shoot_date
 ? new Date(booking.shoot_date).toLocaleDateString("id-ID", {
 weekday: "short",
 day: "numeric",
 month: "short",
 year: "numeric",
                        })
 : "Tanggal belum ditentukan";

                    return (
                      <div
 key={`${booking.project_id}-${idx}`}
 className="bg-white border border-[#ececee] rounded-xl p-3.5 space-y-2.5 hover:border-[#d4d4d8] transition shadow-2xs"
                      >
 <div className="flex items-start justify-between gap-3">
 <div className="space-y-1 flex-1 min-w-0">
                            {/* Service Pillar & Status */}
 <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold ${getPillarBadgeClasses(
                                  booking.service_pillar,
                                )}`}
                              >
                                {booking.service_pillar || "PRODUKSI"}
                              </span>

                              {booking.status && (
                                <span className="inline-block rounded border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[10px] font-medium text-[#52525b]">
                                  {booking.status}
                                </span>
                              )}

                              {booking.return_status && (
                                <span
                                  className={`inline-block rounded border px-2 py-0.5 text-[10px] font-medium ${
                                    booking.return_status === "RETURNED"
                                      ? "border-[#ececee] bg-[#fafafa] text-[#52525b]"
                                      : booking.return_status === "OVERDUE"
                                        ? "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]"
                                        : "border-[#ececee] bg-[#fafafa] text-[#09090b]"
                                  }`}
                                >
                                  {booking.return_status === "RETURNED"
                                    ? "Sudah Dikembalikan"
                                    : booking.return_status === "OVERDUE"
                                      ? "Overdue Pengembalian"
                                      : "Dalam Pemakaian"}
                                </span>
                              )}
                            </div>

                            {/* Project Name */}
 <h4 className="text-xs font-bold text-[#09090b] truncate">
                              {booking.project_name}
                            </h4>
                          </div>

                          {/* Quantity Badge */}
 <div className="text-right shrink-0">
                          <span className="inline-flex items-center gap-1 rounded border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-[11px] font-medium text-[#09090b]">
 <Package size={11} className="text-[#71717a]" />
                              {booking.quantity || 1} Unit
                            </span>
                          </div>
                        </div>

                        {/* Footer row: Shoot date & Link */}
 <div className="flex items-center justify-between pt-1 border-t border-[#fafafa] text-xs">
 <div className="flex items-center gap-1.5 text-[#52525b] text-[11px]">
 <CalendarIcon size={12} className="text-[#a1a1aa]" />
                            <span>{formattedShootDate}</span>
                          </div>

                          <Link
 href={`/admin/projects/${booking.project_id}`}
                            className="inline-flex min-h-11 items-center gap-1 px-2 text-[11px] font-medium text-[#c2410c] hover:underline"
                          >
                            <span>Buka Workspace Proyek</span>
                            <ExternalLink size={11} />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Drawer Footer */}
 <div className="p-4 border-t border-[#ececee] bg-[#fafafa] flex items-center justify-between text-xs text-[#71717a]">
            <span>ELTS Kineva Hardware Registry</span>
 <Button variant="outline" size="sm" onClick={onClose} className="text-xs">
              Tutup
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
