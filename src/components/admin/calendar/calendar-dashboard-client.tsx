"use client";

import React, { useState, useTransition, useEffect, useMemo } from "react";
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

  const [viewMode, setViewMode] = useState<ViewMode>("month");
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

  // Fetch events when month or pillar filter changes
  useEffect(() => {
    // Avoid double fetching on initial mount if already matching initialMonth and ALL
    if (currentMonthKey === initialMonth && selectedPillar === "ALL") {
      setEvents(initialEvents);
      return;
    }

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
      {/* Top Header & Overview */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-[#09090b] font-serif">
              Master Operations Calendar
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#fafafa] text-[#3f3f46] border border-[#ececee]">
              <Sparkles size={11} className="text-[#ff5a00]" />
              Live Sync
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            Jadwal terpadu produksi lapangan, live streaming broadcast, meeting klien,
            dan call time kru.
          </p>
        </div>

        {/* Quick KPI stats chips */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="bg-white border border-border px-3 py-1.5 rounded-lg shadow-2xs flex items-center gap-2">
            <CalendarIcon size={14} className="text-[#71717a]" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-bold text-[#09090b]">{stats.total}</span>
          </div>
          <div className="bg-white border border-border px-3 py-1.5 rounded-lg shadow-2xs flex items-center gap-2">
            <Video size={14} className="text-[#ff5a00]" />
            <span className="text-muted-foreground">Broadcast:</span>
            <span className="font-bold text-[#09090b]">{stats.liveStreaming}</span>
          </div>
          <div className="bg-white border border-border px-3 py-1.5 rounded-lg shadow-2xs flex items-center gap-2">
            <Camera size={14} className="text-[#52525b]" />
            <span className="text-muted-foreground">Foto:</span>
            <span className="font-bold text-[#09090b]">{stats.pictures}</span>
          </div>
          <div className="bg-white border border-border px-3 py-1.5 rounded-lg shadow-2xs flex items-center gap-2">
            <Users size={14} className="text-[#a1a1aa]" />
            <span className="text-muted-foreground">Kru Aktif:</span>
            <span className="font-bold text-[#09090b]">{stats.uniqueCrew}</span>
          </div>
        </div>
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
                className={`flex items-center gap-1.5 px-3 py-1.5 min-h-9 rounded-md text-xs font-semibold transition-all ${
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
                className={`flex items-center gap-1.5 px-3 py-1.5 min-h-9 rounded-md text-xs font-semibold transition-all ${
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
        <div className="pt-2 border-t border-border/60 flex items-center gap-2 overflow-x-auto pb-1">
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
                className={`px-3 py-1 min-h-9 rounded-full text-xs font-medium transition-all shrink-0 cursor-pointer ${
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
