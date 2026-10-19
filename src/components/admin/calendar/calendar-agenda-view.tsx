"use client";

import React, { useMemo } from "react";
import {
  Calendar,
  MapPin,
  Users,
  Video,
  ChevronRight,
  FolderKanban,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/types/calendar";

interface CalendarAgendaViewProps {
  events: CalendarEvent[];
  onSelectEvent: (event: CalendarEvent) => void;
}

function toDateKey(date: Date | string): string {
 const d = typeof date === "string" ? new Date(date) : date;
 return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function CalendarAgendaView({
  events,
  onSelectEvent,
}: CalendarAgendaViewProps) {
  // Sort events chronologically
  const sortedEvents = useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    );
  }, [events]);

  // Today & Tomorrow keys
  const now = new Date();
  const todayKey = toDateKey(now);
  const tomorrowKey = toDateKey(new Date(now.getTime() + 24 * 3600 * 1000));
  const yesterdayKey = toDateKey(new Date(now.getTime() - 24 * 3600 * 1000));

  // Group events by date
  const groups = useMemo(() => {
    const map = new Map<
      string,
      {
        dateKey: string;
        dateObj: Date;
        events: CalendarEvent[];
      }
    >();

    for (const evt of sortedEvents) {
      const key = toDateKey(evt.start_time);
      const group = map.get(key) || {
        dateKey: key,
        dateObj: new Date(evt.start_time),
        events: [],
      };
      group.events.push(evt);
      map.set(key, group);
    }

    return Array.from(map.values());
  }, [sortedEvents]);

  // Badge styles based on pillar. Ember is reserved for live/broadcast — the
  // pillar that actually needs to pull the eye; the rest stay achromatic.
  const getPillarBadgeClasses = (pillar: string) => {
    const p = pillar.toLowerCase();
    if (p.includes("live") || p.includes("stream") || p.includes("broadcast")) {
      return "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]";
    }
    if (p.includes("lab") || p.includes("digital")) {
      return "border-[#ececee] bg-[#fafafa] text-[#09090b]";
    }
    return "border-[#ececee] bg-[#fafafa] text-[#3f3f46]";
  };

  const getEventTypeLabel = (type: string) => {
    switch (type) {
 case "DISCOVERY_CALL":
 return "Discovery Call";
 case "PRE_PRODUCTION":
 return "Pre-Production";
 case "FIELD_SHOOT":
 return "Field Shoot";
 case "DEADLINE":
 return "Deadline";
 case "PROJECT_SHOOT":
 return "Hari Shooting";
 case "CREW_CALL":
 return "Call Time";
      default:
 return type.replace(/_/g, " ");
    }
  };

  if (groups.length === 0) {
    return (
 <div className="bg-white border border-border rounded-xl p-12 text-center shadow-xs">
 <div className="w-12 h-12 rounded-full bg-[#fafafa] text-[#a1a1aa] mx-auto flex items-center justify-center mb-4">
          <CalendarDays size={24} />
        </div>
 <h3 className="text-base font-semibold text-[#09090b] mb-1">
          Tidak Ada Agenda
        </h3>
 <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Tidak ditemukan jadwal event, shooting, ataupun call time kru untuk
          bulan dan filter yang dipilih.
        </p>
      </div>
    );
  }

  return (
 <div className="space-y-6">
      {groups.map((group) => {
 const formattedHeaderDate = group.dateObj.toLocaleDateString("id-ID", {
 weekday: "long",
 day: "numeric",
 month: "long",
 year: "numeric",
 timeZone: "Asia/Jakarta",
        });

        const isToday = group.dateKey === todayKey;
        const isTomorrow = group.dateKey === tomorrowKey;
        const isYesterday = group.dateKey === yesterdayKey;

        return (
          <div
            key={group.dateKey}
 className="bg-white border border-border rounded-xl shadow-xs overflow-hidden"
          >
            {/* Date Group Header */}
            <div
              className={`flex items-center justify-between border-b border-border px-5 py-3 ${
                isToday ? "border-[#ff5a00]/20 bg-[#ff5a00]/10" : "bg-[#fafafa]/70"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Calendar
                  size={16}
                  className={isToday ? "text-[#ff5a00]" : "text-[#71717a]"}
                />
                <span className="text-sm font-semibold text-[#09090b]">
                  {formattedHeaderDate}
                </span>

                {isToday && (
                  <span className="inline-flex items-center rounded-full bg-[#ff5a00] px-2 py-0.5 text-xs font-bold text-white shadow-2xs">
                    Hari Ini
                  </span>
                )}
                {isTomorrow && (
                  <span className="inline-flex items-center rounded-full border border-[#ececee] bg-[#fafafa] px-2 py-0.5 text-xs font-semibold text-[#09090b]">
                    Besok
                  </span>
                )}
                {isYesterday && (
                  <span className="inline-flex items-center rounded-full bg-[#ececee] px-2 py-0.5 text-xs font-medium text-[#3f3f46]">
                    Kemarin
                  </span>
                )}
              </div>

 <span className="text-xs font-medium text-muted-foreground">
                {group.events.length} Agenda
              </span>
            </div>

            {/* Event Items in Timeline */}
 <div className="divide-y divide-border/70">
              {group.events.map((evt) => {
                const startDate = new Date(evt.start_time);
                const endDate = new Date(evt.end_time);

 const startTimeStr = startDate.toLocaleTimeString("id-ID", {
 hour: "2-digit",
 minute: "2-digit",
 timeZone: "Asia/Jakarta",
                });

 const endTimeStr = endDate.toLocaleTimeString("id-ID", {
 hour: "2-digit",
 minute: "2-digit",
 timeZone: "Asia/Jakarta",
                });

                return (
                  <div
                    key={evt.id}
                    onClick={() => onSelectEvent(evt)}
                    className="group flex cursor-pointer flex-col justify-between gap-4 p-4 transition-colors hover:bg-[#fafafa]/80 sm:p-5 md:flex-row md:items-center"
                  >
                    {/* Left: Time chip & Pillar */}
 <div className="flex items-start md:items-center gap-3 shrink-0 md:w-56">
 <div className="bg-[#fafafa] border border-border px-2.5 py-1.5 rounded-md flex flex-col items-center justify-center min-w-[76px] text-center">
 <span className="text-xs font-bold text-[#09090b] tabular-nums">
                          {startTimeStr}
                        </span>
 <span className="text-[10px] text-[#71717a] tabular-nums">
                          s/d {endTimeStr}
                        </span>
                      </div>

 <div className="flex flex-col gap-1">
                        <span
 className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${getPillarBadgeClasses(
                            evt.pillar
 )}`}
                        >
                          {evt.pillar}
                        </span>
 <span className="text-[11px] text-[#71717a] font-medium">
                          {getEventTypeLabel(evt.event_type)}
                        </span>
                      </div>
                    </div>

                    {/* Middle: Title, Location & Project */}
 <div className="flex-1 min-w-0 space-y-1">
 <h4 className="text-base font-semibold text-[#09090b] group-hover:text-primary transition-colors flex items-center gap-2">
 <span className="truncate">{evt.title}</span>
                      </h4>

 <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-muted-foreground">
                        {evt.project_name && (
 <span className="inline-flex items-center gap-1 text-[#52525b]">
 <FolderKanban size={13} className="text-[#a1a1aa]" />
                            {evt.project_name}
                          </span>
                        )}

 <span className="inline-flex items-center gap-1 text-[#52525b]">
 <MapPin size={13} className="text-[#a1a1aa]" />
 <span className="truncate max-w-[240px]">
 {evt.venue_name || "Lokasi belum ditentukan"}
                          </span>
                        </span>

                        {evt.meet_link && (
                          <span className="inline-flex items-center gap-1 rounded border border-[#ececee] bg-[#fafafa] px-2 py-0.5 font-medium text-[#09090b]">
                            <Video size={13} />
                            Google Meet
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Crew count & Detail Action */}
 <div className="flex items-center justify-between md:justify-end gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/60">
                      {evt.assigned_crew.length > 0 ? (
 <div className="flex items-center gap-2">
 <div className="flex items-center gap-1 text-xs font-medium text-[#3f3f46] bg-[#fafafa] border border-border px-2.5 py-1 rounded-md">
 <Users size={13} className="text-[#71717a]" />
                            <span>{evt.assigned_crew.length} Kru</span>
                          </div>

 <div className="hidden lg:flex items-center -space-x-1.5 overflow-hidden">
                            {evt.assigned_crew.slice(0, 3).map((c, i) => (
                              <div
                                key={i}
 title={`${c.name} (${c.role})`}
 className="w-6 h-6 rounded-full bg-[#ececee] border-2 border-white flex items-center justify-center text-[10px] font-bold text-[#3f3f46] shadow-2xs"
                              >
                                {c.name.slice(0, 1).toUpperCase()}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
 <span className="text-xs text-[#a1a1aa] italic">
                          Tanpa kru
                        </span>
                      )}

                      <Button
 variant="ghost"
 size="sm"
                        className="min-h-11 text-xs text-[#3f3f46] group-hover:bg-[#fafafa] group-hover:text-[#09090b]"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectEvent(evt);
                        }}
                      >
                        Detail
 <ChevronRight size={14} className="ml-1" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
