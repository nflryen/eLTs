"use client";

import React, { useState, useTransition, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  List,
  CalendarDays,
  Sparkles,
  Users,
  Video,
  Camera,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCalendarEvents } from "@/app/actions/admin-calendar";
import type { CalendarEvent } from "@/types/calendar";
import { CalendarMonthView } from "./calendar-month-view";
import { CalendarAgendaView } from "./calendar-agenda-view";
import { EventFlyoutDrawer } from "./event-flyout-drawer";

interface CalendarDashboardClientProps {
  initialEvents: CalendarEvent[];
  initialMonth: string; // YYYY-MM
}

type ViewMode = "month" | "agenda";

/** Shared media-query subscription for the compact-viewport default. */
function subscribeViewport(onChange: () => void): () => void {
  const mql = window.matchMedia("(max-width: 767px)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const PILLAR_FILTERS = [
  { id: "ALL", label: "Semua Pilar" },
  { id: "Pictures / Event", label: "Pictures / Event" },
  { id: "Live Streaming", label: "Live Streaming" },
  { id: "Digital Lab", label: "Digital Lab" },
];

export function CalendarDashboardClient({
  initialEvents,
  initialMonth,
}: CalendarDashboardClientProps) {
  // Parse initial year and month
  const [initYear, initMonthNum] = initialMonth.split("-").map(Number);
  const [currentDate, setCurrentDate] = useState<Date>(
    () => new Date(initYear, initMonthNum - 1, 1)
  );

  /*
   * A 7-column month grid is unreadable at 390px: day cells collapse to ~50px
   * and every title truncates to "Call..." / "Shoo...". Mobile therefore opens
   * on the agenda timeline, while desktop keeps the month grid it was designed
   * for. Resolved on mount to avoid a hydration mismatch (the server cannot
   * know the viewport).
   */
  const isCompactViewport = useSyncExternalStore(
    subscribeViewport,
    () => window.matchMedia("(max-width: 767px)").matches,
    // Server snapshot: assume desktop so the month grid renders in the HTML.
    () => false
  );

  /*
   * `null` means "operator has not chosen yet", so the default follows the
   * viewport: agenda on phones, month grid on desktop. The first explicit tap
   * pins the choice. `useSyncExternalStore` reads the media query without a
   * setState-in-effect cascade.
   */
  const [viewModeOverride, setViewMode] = useState<ViewMode | null>(null);
  const viewMode: ViewMode = viewModeOverride ?? (isCompactViewport ? "agenda" : "month");
  const [selectedPillar, setSelectedPillar] = useState<string>("ALL");
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [isPending, startTransition] = useTransition();

  // Helper to format YYYY-MM
  const currentMonthKey = useMemo(() => {
    const y = currentDate.getFullYear();
    const m = String(currentDate.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [currentDate]);

  // Month & Year header label in Indonesian
  const monthHeaderLabel = useMemo(() => {
    return currentDate.toLocaleDateString("id-ID", {
      month: "long",
      year: "numeric",
    });
  }, [currentDate]);

  /*
   * Fetch only when the month or pillar actually differs from what the server
   * already provided. The "initial state" branch does not call setState at all:
   * `events` is seeded from `initialEvents`, so re-assigning it synchronously in
   * an effect body would cause a cascading render for no new information.
   */
  useEffect(() => {
    const isInitialState = currentMonthKey === initialMonth && selectedPillar === "ALL";
    if (isInitialState) return;

    startTransition(async () => {
      try {
        const data = await getCalendarEvents(currentMonthKey, selectedPillar);
        setEvents(data);
      } catch (err) {
        console.error("Failed to fetch calendar events:", err);
      }
    });
  }, [currentMonthKey, selectedPillar, initialMonth, initialEvents]);

  // Navigation handlers
  const handlePrevMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleToday = () => {
    const now = new Date();
    setCurrentDate(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  // Operational Statistics calculated from current events
  const stats = useMemo(() => {
    let liveStreamingCount = 0;
    let picturesCount = 0;
    let meetingsCount = 0;
    const crewSet = new Set<string>();

    for (const evt of events) {
      const p = evt.pillar.toLowerCase();
      if (p.includes("live") || p.includes("stream") || p.includes("broadcast")) {
        liveStreamingCount++;
      } else if (p.includes("picture") || p.includes("photo") || p.includes("event")) {
        picturesCount++;
      }

      if (
        evt.event_type === "DISCOVERY_CALL" ||
        evt.event_type === "PRE_PRODUCTION"
      ) {
        meetingsCount++;
      }

      for (const c of evt.assigned_crew) {
        if (c.name) crewSet.add(c.name);
      }
    }

    return {
      total: events.length,
      liveStreaming: liveStreamingCount,
      pictures: picturesCount,
      meetings: meetingsCount,
      uniqueCrew: crewSet.size,
    };
  }, [events]);

  return (
    <div className="space-y-6">
      {/*
       * HEADER
       * ------
       * Title + sync badge on the left, telemetry on the right as a single
       * aligned chip rail. Previously the chips were stacked in a wrap container
       * that pushed them onto their own ragged rows on narrower widths.
       */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#09090b] md:text-3xl">
              Master Operations Calendar
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#ececee] bg-[#fafafa] px-2.5 py-0.5 text-xs font-semibold text-[#3f3f46]">
              <Sparkles size={11} className="text-[#ff5a00]" aria-hidden="true" />
              Live Sync
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Jadwal terpadu produksi lapangan, live streaming broadcast, meeting klien,
            dan call time kru.
          </p>
        </div>

        <dl
          aria-label="Ringkasan kalender"
          className="flex shrink-0 flex-wrap items-stretch gap-2 text-xs"
        >
          {[
            { label: "Total", value: stats.total, Icon: CalendarIcon, tone: "text-[#71717a]" },
            { label: "Broadcast", value: stats.liveStreaming, Icon: Video, tone: "text-[#ff5a00]" },
            { label: "Foto", value: stats.pictures, Icon: Camera, tone: "text-[#52525b]" },
            { label: "Kru Aktif", value: stats.uniqueCrew, Icon: Users, tone: "text-[#a1a1aa]" },
          ].map(({ label, value, Icon, tone }) => (
            <div
              key={label}
              className="flex min-w-[7.5rem] flex-1 items-center gap-2 rounded-[12px] border border-[#ececee] bg-white px-3 py-2 lg:flex-none"
            >
              <Icon size={14} className={tone} aria-hidden="true" />
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="ml-auto font-mono font-bold tabular-nums text-[#09090b]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Main Control Toolbar */}
      <div className="bg-white border border-border rounded-xl p-4 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Month Navigation */}
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-border bg-[#fafafa] p-0.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevMonth}
                aria-label="Bulan sebelumnya"
                className="h-8 w-8 p-0 text-[#52525b] hover:text-[#09090b]"
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToday}
                className="h-8 px-2.5 text-xs font-semibold text-[#3f3f46] hover:text-[#09090b]"
              >
                Bulan Ini
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextMonth}
                aria-label="Bulan berikutnya"
                className="h-8 w-8 p-0 text-[#52525b] hover:text-[#09090b]"
              >
                <ChevronRight size={16} />
              </Button>
            </div>

            <div className="text-lg font-serif font-bold text-[#09090b] capitalize px-2 flex items-center gap-2">
              <span>{monthHeaderLabel}</span>
              {isPending && (
                <RefreshCw size={14} className="animate-spin text-[#a1a1aa]" />
              )}
            </div>
          </div>

          {/* View Switchers & Pillar Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* View Switcher: Bulan vs Agenda */}
            <div className="flex items-center rounded-lg border border-border bg-[#f4f4f5] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("month")}
                className={`flex min-h-12 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all md:min-h-9 md:py-1.5 ${
                  viewMode === "month"
                    ? "bg-white text-[#09090b] shadow-2xs"
                    : "text-[#52525b] hover:text-[#09090b]"
                }`}
              >
                <CalendarDays size={14} />
                Bulan
              </button>
              <button
                type="button"
                onClick={() => setViewMode("agenda")}
                className={`flex min-h-12 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all md:min-h-9 md:py-1.5 ${
                  viewMode === "agenda"
                    ? "bg-white text-[#09090b] shadow-2xs"
                    : "text-[#52525b] hover:text-[#09090b]"
                }`}
              >
                <List size={14} />
                Agenda Timeline
              </button>
            </div>
          </div>
        </div>

        {/* Pillar Filter Pills */}
        {/*
         * `no-scrollbar` hides the native bar that used to slice across the
         * pills; the row still scrolls by touch, trackpad and keyboard.
         */}
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-t border-border/60 pb-1 pt-2">
          <span className="text-xs font-medium text-muted-foreground mr-1 shrink-0">
            Filter Pilar:
          </span>
          {PILLAR_FILTERS.map((f) => {
            const isSelected = selectedPillar === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedPillar(f.id)}
                className={`inline-flex min-h-12 shrink-0 cursor-pointer items-center rounded-full px-3.5 text-xs font-medium transition-all md:min-h-9 ${
                  isSelected
                    ? "bg-[#ff5a00] text-white font-semibold shadow-2xs"
                    : "bg-[#f4f4f5] text-[#52525b] hover:bg-[#ececee] hover:text-[#09090b] border border-transparent"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Calendar View Mode Render */}
      <div className={isPending ? "opacity-75 transition-opacity" : ""}>
        {viewMode === "month" ? (
          <CalendarMonthView
            currentDate={currentDate}
            events={events}
            onSelectEvent={setSelectedEvent}
          />
        ) : (
          <CalendarAgendaView
            events={events}
            onSelectEvent={setSelectedEvent}
          />
        )}
      </div>

      {/* Event Details Slide-over Drawer */}
      <EventFlyoutDrawer
        event={selectedEvent}
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
