"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import {
  X,
  Calendar,
  Clock,
  MapPin,
  Users,
  Video,
  ExternalLink,
  FolderKanban,
  FileText,
  Shirt,
  User,
  Phone,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/types/calendar";

interface EventFlyoutDrawerProps {
  event: CalendarEvent | null;
  isOpen: boolean;
  onClose: () => void;
}

export function EventFlyoutDrawer({
  event,
  isOpen,
  onClose,
}: EventFlyoutDrawerProps) {
  // Listen for Escape key
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

  if (!isOpen || !event) return null;

  // Formatting date and time
  const startDate = new Date(event.start_time);
  const endDate = new Date(event.end_time);

 const formattedDate = startDate.toLocaleDateString("id-ID", {
 weekday: "long",
 day: "numeric",
 month: "long",
 year: "numeric",
 timeZone: "Asia/Jakarta",
  });

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

  const durationHours = Math.max(
    1,
    Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
  );

  // Badge styles based on pillar. Ember is reserved for the live/broadcast
  // pillar; the rest stay achromatic.
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

  // Badge styles for event types
  const getEventTypeLabel = (type: string) => {
    switch (type) {
 case "DISCOVERY_CALL":
 return "Discovery Call";
 case "PRE_PRODUCTION":
 return "Pre-Production Meeting";
 case "FIELD_SHOOT":
 return "Field Shoot";
 case "DEADLINE":
 return "Deadline";
 case "PROJECT_SHOOT":
 return "Hari Shooting";
 case "CREW_CALL":
 return "Call Time Kru";
      default:
 return type.replace(/_/g, " ");
    }
  };

  const getEventTypeBadgeClasses = (type: string) => {
    switch (type) {
      case "DISCOVERY_CALL":
      case "PRE_PRODUCTION":
        return "border-[#ececee] bg-[#fafafa] text-[#3f3f46]";
      case "DEADLINE":
        return "border-[#ff5a00]/30 bg-[#ff5a00]/10 text-[#c2410c]";
      case "FIELD_SHOOT":
      case "PROJECT_SHOOT":
        return "border-[#ececee] bg-[#fafafa] text-[#09090b]";
      case "CREW_CALL":
        return "border-[#ececee] bg-[#fafafa] text-[#52525b]";
      default:
        return "border-[#ececee] bg-[#fafafa] text-[#52525b]";
    }
  };

  return (
 <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
 className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200 animate-in fade-in"
        onClick={onClose}
 aria-hidden="true"
      />

      {/* Flyout Panel */}
 <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
 <div className="w-screen max-w-md bg-white border-l border-border shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
          {/* Header */}
 <div className="p-6 border-b border-border bg-[#fafafa]/70">
 <div className="flex items-start justify-between gap-4">
 <div className="space-y-1">
 <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span
 className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getPillarBadgeClasses(
                      event.pillar
 )}`}
                  >
                    {event.pillar}
                  </span>
                  <span
 className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getEventTypeBadgeClasses(
                      event.event_type
 )}`}
                  >
                    {getEventTypeLabel(event.event_type)}
                  </span>
                  {event.status && (
                  <span className="inline-flex items-center rounded-full bg-[#ececee]/80 px-2 py-0.5 text-[11px] font-medium text-[#3f3f46]">
                      {event.status}
                    </span>
                  )}
                </div>
 <h2 className="text-xl font-bold tracking-tight text-[#09090b] leading-snug">
                  {event.title}
                </h2>
                {event.project_name && (
 <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-0.5">
 <FolderKanban size={13} className="text-[#a1a1aa] shrink-0" />
                    <span>Project: {event.project_name}</span>
                  </p>
                )}
              </div>
              <button
 type="button"
                onClick={onClose}
                className="rounded-md p-3 text-[#a1a1aa] transition-colors hover:bg-[#fafafa] hover:text-[#3f3f46]"
 aria-label="Tutup Detail Agenda"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Scrollable Body */}
 <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Section 1: Waktu & Jam */}
 <div className="space-y-3">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
 <Clock size={14} className="text-[#a1a1aa]" />
                Waktu & Jam Pelaksanaan
              </h3>
 <div className="bg-[#fafafa] border border-border/80 rounded-lg p-3.5 space-y-2">
 <div className="flex items-center gap-2.5 text-sm font-medium text-[#27272a]">
 <Calendar size={15} className="text-[#71717a] shrink-0" />
                  <span>{formattedDate}</span>
                </div>
 <div className="flex items-center justify-between text-xs text-[#52525b] pl-6">
                  <span>
                    {startTimeStr} — {endTimeStr} WIB
                  </span>
 <span className="font-medium text-[#71717a] bg-white border border-border px-2 py-0.5 rounded text-[11px]">
                    ± {durationHours} Jam
                  </span>
                </div>
              </div>
            </div>

            {/* Section 2: Lokasi & Venue */}
 <div className="space-y-3">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
 <MapPin size={14} className="text-[#a1a1aa]" />
                Lokasi & Venue
              </h3>
 <div className="bg-[#fafafa] border border-border/80 rounded-lg p-3.5 space-y-3">
 <div className="text-sm font-medium text-[#27272a]">
 {event.venue_name || "Lokasi belum ditentukan"}
                </div>

                {event.venue_maps_url && (
                  <div>
                    <a
                      href={event.venue_maps_url}
 target="_blank"
 rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 px-2 text-xs font-medium text-[#c2410c] hover:underline"
                    >
                      <MapPin size={13} />
                      Buka di Google Maps
                      <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                {event.meet_link && (
 <div className="pt-1">
                    <a
                      href={event.meet_link}
 target="_blank"
 rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 rounded-[12px] border border-[#ff5a00]/30 bg-[#ff5a00]/10 px-3 text-xs font-medium text-[#c2410c] transition-colors hover:bg-[#ff5a00]/20"
                    >
                      <Video size={14} className="text-[#ff5a00]" />
                      Gabung Google Meet
                      <ExternalLink size={12} />
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Section 3: Assigned Crew */}
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
 <Users size={14} className="text-[#a1a1aa]" />
                  Tim & Kru Bertugas
                </h3>
 <span className="text-[11px] font-medium bg-[#fafafa] text-[#52525b] px-2 py-0.5 rounded-full">
                  {event.assigned_crew.length} Kru
                </span>
              </div>

              {event.assigned_crew.length > 0 ? (
 <div className="space-y-2">
                  {event.assigned_crew.map((crew, idx) => (
                    <div
                      key={idx}
 className="flex items-center justify-between bg-[#fafafa] border border-border/80 rounded-lg px-3.5 py-2.5"
                    >
 <div className="flex items-center gap-2.5">
 <div className="w-7 h-7 rounded-full bg-[#ececee] flex items-center justify-center text-xs font-bold text-[#52525b]">
                          {crew.name.slice(0, 1).toUpperCase()}
                        </div>
 <span className="text-sm font-medium text-[#09090b]">
                          {crew.name}
                        </span>
                      </div>
 <span className="text-xs font-medium text-[#52525b] bg-white border border-border px-2 py-0.5 rounded">
                        {crew.role}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
 <div className="text-xs text-muted-foreground bg-[#fafafa] border border-dashed border-border rounded-lg p-3.5 text-center">
                  Belum ada kru yang ditugaskan untuk agenda ini.
                </div>
              )}
            </div>

            {/* Section 4: Briefing & Technical Details */}
            {(event.dress_code || event.notes || event.client_name) && (
 <div className="space-y-3">
 <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
 <FileText size={14} className="text-[#a1a1aa]" />
                  Briefing & Informasi Tambahan
                </h3>
 <div className="bg-[#fafafa] border border-border/80 rounded-lg p-3.5 space-y-3 text-xs">
                  {event.dress_code && (
 <div className="flex items-start gap-2">
 <Shirt size={14} className="text-[#a1a1aa] mt-0.5 shrink-0" />
                      <div>
 <span className="font-semibold text-[#3f3f46]">Dress Code: </span>
 <span className="text-[#52525b]">{event.dress_code}</span>
                      </div>
                    </div>
                  )}

                  {event.notes && (
 <div className="flex items-start gap-2">
 <FileText size={14} className="text-[#a1a1aa] mt-0.5 shrink-0" />
                      <div>
 <span className="font-semibold text-[#3f3f46]">Catatan / Briefing: </span>
 <p className="text-[#52525b] whitespace-pre-line mt-0.5 leading-relaxed">
                          {event.notes}
                        </p>
                      </div>
                    </div>
                  )}

                  {event.client_name && (
 <div className="pt-2 border-t border-border/60 space-y-1.5">
 <div className="font-semibold text-[#3f3f46] flex items-center gap-1.5">
 <User size={13} className="text-[#a1a1aa]" />
                        Klien: {event.client_name}
                      </div>
                      {event.client_phone && (
 <div className="flex items-center gap-1.5 text-[#52525b]">
 <Phone size={13} className="text-[#a1a1aa]" />
                          <a
 href={`https://wa.me/${event.client_phone.replace(/\D/g, "")}`}
 target="_blank"
 rel="noopener noreferrer"
                            className="inline-flex min-h-11 items-center px-2 text-[#c2410c] hover:underline"
                          >
                            {event.client_phone} (WhatsApp)
                          </a>
                        </div>
                      )}
                      {event.client_email && (
 <div className="flex items-center gap-1.5 text-[#52525b]">
 <Mail size={13} className="text-[#a1a1aa]" />
                          <a
 href={`mailto:${event.client_email}`}
                            className="inline-flex min-h-11 items-center px-2 text-[#c2410c] hover:underline"
                          >
                            {event.client_email}
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer Action Bar */}
 <div className="p-4 border-t border-border bg-white flex items-center gap-3">
            {event.project_id ? (
 <Button asChild className="flex-1" variant="default">
 <Link href={`/admin/projects/${event.project_id}`}>
 <FolderKanban size={16} className="mr-2" />
                  Buka Workspace Project
                </Link>
              </Button>
            ) : null}
            <Button
 variant="outline"
              onClick={onClose}
 className={event.project_id ? "" : "w-full"}
            >
              Tutup
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
