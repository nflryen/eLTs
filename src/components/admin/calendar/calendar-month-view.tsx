"use client";

import React, { useMemo } from "react";
import { Video, MapPin, Plus } from "lucide-react";
import type { CalendarEvent, AssignedCrewMember } from "@/types/calendar";

interface CalendarMonthViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
  onDateClick?: (date: Date) => void;
}

type EventCategory = "LIVE" | "PHOTO" | "RECCE/GLADI" | "DEADLINE";

interface CategoryMeta {
  category: EventCategory;
  badgeClass: string;
  cardClass: string;
  dotColor: string;
}

const DAY_NAMES = [
  { short: "Sen", full: "Senin" },
  { short: "Sel", full: "Selasa" },
  { short: "Rab", full: "Rabu" },
  { short: "Kam", full: "Kamis" },
  { short: "Jum", full: "Jumat" },
  { short: "Sab", full: "Sabtu" },
  { short: "Min", full: "Minggu" },
];

const AVATAR_BG_COLORS = [
  "bg-[#09090b] text-white",
  "bg-[#3f3f46] text-white",
  "bg-[#52525b] text-white",
  "bg-[#71717a] text-white",
  "bg-[#a1a1aa] text-white",
  "bg-[#d4d4d8] text-[#09090b]",
];

/**
 * Returns YYYY-MM-DD string in Asia/Jakarta timeZone
 */
function toDateKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/**
 * Extracts 1-2 uppercase initials from a person's name
 */
function getInitials(name: string): string {
  if (!name || typeof name !== "string") return "?";
  const clean = name.trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Resolves the event category and its design tokens. Only LIVE / broadcast
 * events carry the Ember accent; every other category is neutral zinc.
 * - LIVE: broadcast, live streaming, OBS — Ember
 * - PHOTO: default photography, event shoot, wedding — neutral
 * - RECCE/GLADI: discovery calls, technical meetings, pre-production — neutral
 * - DEADLINE: deliverable deadlines, milestones — neutral
 */
function resolveEventCategory(evt: CalendarEvent): CategoryMeta {
  const type = evt.event_type.toUpperCase();
  const titleLower = evt.title.toLowerCase();
  const pillarLower = evt.pillar.toLowerCase();

  // 1. DEADLINE (neutral)
  if (type === "DEADLINE" || titleLower.includes("deadline")) {
    return {
      category: "DEADLINE",
      badgeClass: "bg-[#fafafa] text-[#3f3f46] border-[#ececee]",
      cardClass: "bg-[#fafafa] border-[#ececee] text-[#18181b] hover:bg-[#f4f4f5] hover:border-[#d4d4d8]",
      dotColor: "bg-[#3f3f46]",
    };
  }

  // 2. RECCE/GLADI (Blue - Striped Rehearsal Bar)
  if (
    type === "DISCOVERY_CALL" ||
    type === "PRE_PRODUCTION" ||
    titleLower.includes("recce") ||
    titleLower.includes("gladi") ||
    titleLower.includes("rehearsal") ||
    titleLower.includes("cabling") ||
    titleLower.includes("meeting")
  ) {
    return {
      category: "RECCE/GLADI",
      badgeClass: "bg-[#f4f4f5] text-[#3f3f46] border-[#d4d4d8]",
      cardClass:
        "bg-[#fafafa] border-[#d4d4d8] border-dashed text-[#18181b] bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(113,113,122,0.10)_6px,rgba(113,113,122,0.10)_12px)] hover:border-[#a1a1aa] hover:shadow-xs",
      dotColor: "bg-[#71717a]",
    };
  }

  // 3. LIVE (Purple)
  if (
    pillarLower.includes("live") ||
    pillarLower.includes("stream") ||
    pillarLower.includes("broadcast") ||
    titleLower.includes("live")
  ) {
    return {
      category: "LIVE",
      badgeClass: "bg-[#ff5a00]/10 text-[#ff5a00] border-[#ff5a00]/40",
      cardClass: "bg-[#ff5a00]/8 border-[#ff5a00]/30 text-[#09090b] hover:bg-[#ff5a00]/12 hover:border-[#ff5a00]/50",
      dotColor: "bg-[#ff5a00]",
    };
  }

  // 4. PHOTO (neutral) - default
  return {
    category: "PHOTO",
    badgeClass: "bg-[#fafafa] text-[#3f3f46] border-[#ececee]",
    cardClass: "bg-[#fafafa] border-[#ececee] text-[#18181b] hover:bg-[#f4f4f5] hover:border-[#d4d4d8]",
    dotColor: "bg-[#a1a1aa]",
  };
}

/**
 * Crew initials avatar stack with hover tooltips showing name and role
 */
function CrewAvatarStack({ crew }: { crew: AssignedCrewMember[] }) {
  if (!crew || crew.length === 0) return null;

  const maxVisible = 3;
  const visible = crew.slice(0, maxVisible);
  const remaining = crew.length - maxVisible;

  return (
    <div className="flex items-center -space-x-1 overflow-hidden shrink-0">
      {visible.map((m, idx) => {
        const initials = getInitials(m.name);
        const colorClass = AVATAR_BG_COLORS[idx % AVATAR_BG_COLORS.length];
        const roleLabel = m.role ? ` (${m.role})` : "";

        return (
          <span
            key={idx}
            title={`${m.name}${roleLabel}`}
            className={`inline-flex items-center justify-center w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full ring-1 ring-white text-[8px] font-bold shadow-2xs select-none ${colorClass}`}
          >
            {initials}
          </span>
        );
      })}
      {remaining > 0 && (
        <span
          title={`${remaining} kru lainnya`}
          className="inline-flex items-center justify-center w-4 h-4 sm:w-4.5 sm:h-4.5 rounded-full ring-1 ring-white bg-[#ececee] text-[#3f3f46] text-[7px] font-bold shadow-2xs select-none"
        >
          +{remaining}
        </span>
      )}
    </div>
  );
}

export function CalendarMonthView({
  currentDate,
  events,
  onSelectEvent,
  onDateClick,
}: CalendarMonthViewProps) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Index events by YYYY-MM-DD key for fast cell lookups
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const evt of events) {
      const key = toDateKey(evt.start_time);
      const list = map.get(key) || [];
      list.push(evt);
      map.set(key, list);
    }
    return map;
  }, [events]);

  // Today's date key
  const todayKey = toDateKey(new Date());

  // Build grid calendar days
  const gridDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    // Monday-first starting index (0 for Monday, 6 for Sunday)
    const startingDayIndex = (firstDayOfMonth.getDay() + 6) % 7;
    const totalCells = Math.ceil((startingDayIndex + daysInMonth) / 7) * 7;

    const cells: Array<{
      date: Date;
      dateKey: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < totalCells; i++) {
      let cellDate: Date;
      let dayNumber: number;
      let isCurrentMonth = false;

      if (i < startingDayIndex) {
        dayNumber = daysInPrevMonth - startingDayIndex + i + 1;
        cellDate = new Date(year, month - 1, dayNumber);
      } else if (i < startingDayIndex + daysInMonth) {
        dayNumber = i - startingDayIndex + 1;
        cellDate = new Date(year, month, dayNumber);
        isCurrentMonth = true;
      } else {
        dayNumber = i - (startingDayIndex + daysInMonth) + 1;
        cellDate = new Date(year, month + 1, dayNumber);
      }

      const dateKey = toDateKey(cellDate);
      cells.push({
        date: cellDate,
        dateKey,
        dayNumber,
        isCurrentMonth,
        isToday: dateKey === todayKey,
      });
    }

    return cells;
  }, [year, month, todayKey]);

  return (
    <div className="bg-white border border-[#ececee] rounded-xl shadow-xs overflow-hidden flex flex-col">
      {/* Day of Week Headers */}
      <div className="grid grid-cols-7 border-b border-[#ececee] bg-[#fafafa] text-center text-xs font-semibold text-[#52525b]">
        {DAY_NAMES.map((d, idx) => (
          <div
            key={idx}
            className={`py-3 px-2 ${
              idx === 5 || idx === 6 ? "text-[#71717a] bg-[#f4f4f5]" : ""
            }`}
          >
            <span className="hidden sm:inline">{d.full}</span>
            <span className="sm:hidden">{d.short}</span>
          </div>
        ))}
      </div>

      {/* Monthly Days Grid */}
      <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#ececee] bg-[#ececee]">
        {gridDays.map((cell, idx) => {
          const dayEvents = eventsByDate.get(cell.dateKey) || [];
          // Display up to 2 rich project cards per cell on desktop, with overflow trigger
          const visibleEvents = dayEvents.slice(0, 2);
          const hiddenCount = dayEvents.length - visibleEvents.length;

          return (
            <div
              key={idx}
              onClick={() => onDateClick?.(cell.date)}
              className={`group min-h-[110px] sm:min-h-[135px] md:min-h-[155px] p-1.5 sm:p-2 flex flex-col justify-between transition-colors bg-white cursor-pointer hover:bg-[#fafafa] ${
                !cell.isCurrentMonth
                  ? "bg-[#fafafa] text-[#a1a1aa] opacity-60"
                  : "text-[#09090b]"
              } ${cell.isToday ? "bg-[#ff5a00]/5" : ""}`}
            >
              {/* Day Cell Header */}
              <div className="flex items-center justify-between mb-1.5">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 text-xs font-semibold rounded-full ${
                    cell.isToday
                      ? "bg-[#ff5a00] text-white shadow-xs"
                      : cell.isCurrentMonth
                      ? "text-[#3f3f46] group-hover:text-[#09090b]"
                      : "text-[#a1a1aa]"
                  }`}
                >
                  {cell.dayNumber}
                </span>

                {dayEvents.length > 0 ? (
                  <span className="text-[10px] text-[#71717a] font-medium hidden sm:inline">
                    {dayEvents.length} agenda
                  </span>
                ) : cell.isCurrentMonth ? (
                  <span className="text-[10px] text-[#a1a1aa] opacity-0 group-hover:opacity-100 transition-opacity hidden sm:inline-flex items-center gap-0.5">
                    <Plus size={10} /> Tambah
                  </span>
                ) : null}
              </div>

              {/* Day Cell Event Cards */}
              <div className="flex-1 space-y-1.5 overflow-hidden">
                {visibleEvents.map((evt) => {
                  const meta = resolveEventCategory(evt);

                  const startTime = new Date(evt.start_time).toLocaleTimeString(
                    "id-ID",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "Asia/Jakarta",
                    }
                  );

                  return (
                    <button
                      key={evt.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectEvent(evt);
                      }}
                      className={`w-full text-left p-2 min-h-11 rounded-lg text-[11px] border transition-all shadow-2xs group/card cursor-pointer flex flex-col gap-1 ${meta.cardClass}`}
                      title={`${startTime} • ${evt.title} (${meta.category})`}
                    >
                      {/* Top Row: Category Badge & Start Time */}
                      <div className="flex items-center justify-between gap-1 w-full">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-wider uppercase leading-none ${meta.badgeClass}`}
                        >
                          {meta.category}
                        </span>
                        <span className="font-semibold tabular-nums text-[10px] opacity-75 shrink-0">
                          {startTime}
                        </span>
                      </div>

                      {/* Middle Row: Event Title */}
                      <div className="font-semibold text-[#09090b] truncate leading-snug w-full text-[11px]">
                        {evt.title}
                      </div>

                      {/* Bottom Row: Location icon + Crew Avatar Stack */}
                      <div className="flex items-center justify-between gap-1 pt-0.5 mt-auto w-full">
                        <div className="flex items-center gap-1 text-[10px] text-[#71717a] truncate">
                          {evt.meet_link ? (
                            <span className="flex items-center gap-0.5 text-[#09090b]" title="Google Meet">
                              <Video size={10} className="shrink-0" />
                              <span className="hidden md:inline truncate">Online</span>
                            </span>
                          ) : evt.venue_name ? (
                            <span className="flex items-center gap-0.5 truncate text-[#52525b]" title={evt.venue_name}>
                              <MapPin size={10} className="shrink-0 text-[#a1a1aa]" />
                              <span className="hidden md:inline truncate max-w-[70px]">
                                {evt.venue_name}
                              </span>
                            </span>
                          ) : null}
                        </div>

                        {/* Crew Initials Avatar Stack */}
                        <CrewAvatarStack crew={evt.assigned_crew} />
                      </div>
                    </button>
                  );
                })}

                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onDateClick) {
                        onDateClick(cell.date);
                      } else if (dayEvents[0]) {
                        onSelectEvent(dayEvents[0]);
                      }
                    }}
                    className="w-full text-left text-[10px] font-medium text-[#52525b] hover:text-[#09090b] px-1 py-0.5 min-h-11 rounded hover:bg-[#f4f4f5] transition-colors flex items-center justify-between"
                  >
                    <span>+ {hiddenCount} lainnya...</span>
                  </button>
                )}
              </div>

              {/* Clean Empty State guidance for days with no events */}
              {dayEvents.length === 0 && cell.isCurrentMonth && (
                <div className="hidden sm:flex items-center justify-center flex-1 py-2 text-[10px] text-[#a1a1aa] group-hover:text-[#71717a] transition-colors">
                  <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                    Klik untuk agenda
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
