"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, MapPin, Navigation, PhoneCall, MessageCircle,
  CalendarClock, Radio, Video, Camera, ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/glass";
import { WORKSPACE_MODULE_LABEL, type WorkspaceModule } from "@/lib/workspace-contract";
import type { WorkspacePayload } from "@/lib/workspace";
import { jakartaInstant, jakartaShortDate } from "@/lib/datetime";

/**
 * Operational Spine — the persistent left rail of the Project Console.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous workspace was five peer tabs. The moment you tapped "Crew" you
 * lost the three facts a field lead needs at 06:00 on shoot day: which project,
 * how long until roll, and where. This spine keeps them on screen regardless of
 * which module is open, and collapses to a horizontal strip on mobile.
 *
 * It also answers a question no previous screen could: can the client actually
 * reach us right now? PIC and TD get one-tap `tel:` and `wa.me` links.
 */

const PILLAR_META: Record<string, { label: string; icon: React.ReactNode }> = {
  BROADCAST_LIVE_STREAMING: {
    label: "Broadcast & FOH",
    icon: <Radio size={12} />,
  },
  COMMERCIAL_VIDEO: {
    label: "Video Commercial",
    icon: <Video size={12} />,
  },
  EVENT_GRADUATION_PHOTO: {
    label: "Foto & Wisuda",
    icon: <Camera size={12} />,
  },
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", editing: "Editing", ready: "Siap", expired: "Kedaluwarsa", archived: "Arsip",
};

/** The roll instant, derived the same way the countdown derives it. */
function rollInstant(shootDate: string | null, rollTimeIso: string | null): string | null {
  if (!shootDate) return null;
  return rollTimeIso ?? jakartaInstant(shootDate, "07:30:00");
}

function pad(n: number): string {
  return String(Math.floor(Math.abs(n))).padStart(2, "0");
}

/** Live T-minus countdown. Tabular-nums so the digits never jitter. */
function Countdown({ shootDate, rollTimeIso }: { shootDate: string | null; rollTimeIso: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!shootDate) {
    return (
      <p className="font-mono text-xs text-[#71717a]">Tanggal belum ditentukan</p>
    );
  }

  /*
   * The target must be an absolute instant, and both inputs are already
   * timezone-correct: `shoot_date` is a plain date, `rollTimeIso` is a
   * timestamptz straight from Postgres. Never round-trip through a display
   * string — Indonesian locale renders "07.30" with a dot separator, which
   * cannot be parsed back into a time and yields Invalid Date.
   */
  const rollIso = rollInstant(shootDate, rollTimeIso) ?? jakartaInstant(shootDate, "07:30:00");
  const diff = new Date(rollIso).getTime() - now;
  const overdue = diff < 0;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const mins = Math.floor((abs % 3600000) / 60000);
  const secs = Math.floor((abs % 60000) / 1000);

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a1a1aa]">
        {overdue ? "Sudah Roll" : "Menuju Roll"}
      </p>
      <p className="mt-1 font-semibold text-[#09090b] tabular-nums text-lg">
        {days > 0 ? `${days}h ` : ""}
        {pad(hours)}:{pad(mins)}:{pad(secs)}
      </p>
      <p className="mt-0.5 font-mono text-[13px] text-[#52525b]">
        ROLL {new Date(rollIso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" })} WIB
      </p>
    </div>
  );
}

function QuickContact({
  role, name, phone,
}: { role: string; name: string; phone: string | null }) {
  const digits = (phone ?? "").replace(/\D/g, "");
  const wa = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">{role}</p>
        <p className="truncate text-xs font-medium text-[#18181b]">{name}</p>
      </div>
      {digits ? (
        <div className="flex shrink-0 gap-1">
          <a
            href={`tel:${digits}`}
            aria-label={`Telepon ${role}`}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-[#ececee] text-[#52525b] transition-colors hover:bg-[#f4f4f5]"
          >
            <PhoneCall size={14} />
          </a>
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`WhatsApp ${role}`}
            className="inline-flex size-9 items-center justify-center rounded-lg bg-[#ff5a00] text-white transition-colors hover:bg-[#ff7a33]"
          >
            <MessageCircle size={14} />
          </a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Contextual rail: the project's state at a glance.
 *
 * Module switching deliberately does NOT live here. There is exactly one module
 * picker (the top tab bar) — two competing pickers on one screen is the clutter
 * this rail used to cause.
 */
export function OperationalSpine({ data }: { data: WorkspacePayload }) {
  /*
   * `Date.now()` is impure; evaluating it during render would make the render
   * non-deterministic (and breaks React Compiler memoisation). The spine is
   * mounted per project, so a mount-time instant is a faithful "now" for the
   * 48h hot-window badge.
   */
  const nowMs = useState(() => Date.now())[0];
  const pillar = PILLAR_META[data.project.service_pillar] ?? PILLAR_META.EVENT_GRADUATION_PHOTO;

  const td = data.crew.find((c) => /technical director|director/i.test(c.role_title)) ?? data.crew[0];
  const pending = data.crew.filter((c) => c.acceptance_status === "PENDING_OFFER").length;
  const declined = data.crew.filter((c) => c.acceptance_status === "DECLINED").length;
  const unpacked = data.gear.filter((g) => g.asset_id && g.pack_status === "PENDING").length;

  // Ember only for a broadcast shoot that is live within a 48h window — the
  // signal that a production is actually hot right now.
  const rollIso = rollInstant(data.project.shoot_date, data.crew[0]?.roll_time ?? null);
  const within48h =
    rollIso !== null &&
    Math.abs(new Date(rollIso).getTime() - nowMs) <= 48 * 3600 * 1000;
  const hotBroadcast = data.project.service_pillar === "BROADCAST_LIVE_STREAMING" && within48h;

  return (
    /*
     * `lg:self-start` is load-bearing. Without it the parent flex row
     * (`lg:items-start` is set, but a stretched basis still applies) sizes this
     * aside to the full height of the module column — leaving a
     * `position: sticky` child no room to travel, so the spine scrolls away
     * with the content instead of pinning.
     */
    <aside
      className="lg:sticky lg:top-6 lg:w-64 lg:shrink-0 lg:self-start"
      aria-label="Ringkasan proyek"
    >
      {/*
       * A docked rail, not a floating card: a single hairline right border ties
       * it to the workspace column and removes the "detached card" look. 256px
       * (down from 288px) returns horizontal room to the module pane.
       */}
      <div className="rounded-[18px] border border-[#ececee] bg-white p-5 lg:rounded-none lg:rounded-l-[18px] lg:border-y-0 lg:border-l-0 lg:bg-transparent lg:py-1 lg:pl-0 lg:pr-5">
        <Link
          href="/admin/projects"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#71717a] transition-colors hover:text-[#09090b]"
        >
          <ArrowLeft size={13} /> Semua Proyek
        </Link>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Badge variant={hotBroadcast ? "ember" : "outline"}>
            {pillar.icon} {pillar.label}
          </Badge>
          <span className="rounded-full border border-[#ececee] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#52525b]">
            {STATUS_LABEL[data.project.status] ?? data.project.status}
          </span>
        </div>

        <h1 className="mt-2 text-lg font-semibold leading-tight tracking-tight text-[#09090b]">
          {data.project.name}
        </h1>
        {data.customer ? (
          <p className="mt-1 text-xs font-medium text-[#71717a]">{data.customer.name}</p>
        ) : null}

        {/* Countdown */}
        <div className="mt-4 border-t border-[#ececee] pt-3.5">
          <Countdown
            shootDate={data.project.shoot_date}
            rollTimeIso={data.crew[0]?.roll_time ?? null}
          />
        </div>

        {/* Venue */}
        <div className="mt-3.5 border-t border-[#ececee] pt-3.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
            <MapPin size={11} /> Lokasi
          </p>
          <p className="mt-1 text-xs font-medium leading-snug text-[#18181b]">
            {data.venue.name}
          </p>
          {data.venue.address ? (
            <p className="mt-0.5 text-[11px] leading-snug text-[#71717a]">{data.venue.address}</p>
          ) : null}
          {data.venue.mapsUrl ? (
            <a
              href={data.venue.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#09090b] px-3 text-[11px] font-semibold text-white transition-colors hover:bg-[#18181b]"
            >
              <Navigation size={12} /> Buka Peta
            </a>
          ) : null}
        </div>

        {/* Rehearsal */}
        {data.project.rehearsal_date ? (
          <div className="mt-3.5 border-t border-[#ececee] pt-3.5">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
              <CalendarClock size={11} /> Gladi Resik (D-1)
            </p>
            <p className="mt-1 font-mono text-xs font-semibold text-[#18181b]">
              {jakartaShortDate(`${data.project.rehearsal_date}T00:00:00+07:00`)}
            </p>
          </div>
        ) : null}

        {/* Quick contacts — one tap to call from the field */}
        <div className="mt-3.5 border-t border-[#ececee] pt-3.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#a1a1aa]">
            Kontak Kunci
          </p>
          <div className="mt-1 divide-y divide-[#ececee]">
            {data.customer ? <QuickContact role="Klien / PIC" name={data.customer.name} phone={data.customer.phone} /> : null}
            {td ? <QuickContact role={td.role_title} name={td.crew_name} phone={td.crew_phone} /> : null}
          </div>
        </div>

        {/* Blockers — the reason you cannot go live */}
        {pending > 0 || declined > 0 || unpacked > 0 ? (
          <div className="mt-3.5 space-y-1.5 border-t border-[#ececee] pt-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#ff5a00]">
              Perlu Tindakan
            </p>
            {pending > 0 ? <p className="text-[11px] text-[#52525b]">• {pending} kru belum konfirmasi</p> : null}
            {declined > 0 ? <p className="text-[11px] text-[#ff5a00]">• {declined} kru menolak</p> : null}
            {unpacked > 0 ? <p className="text-[11px] text-[#52525b]">• {unpacked} alat belum dicek</p> : null}
          </div>
        ) : null}

      </div>
    </aside>
  );
}

