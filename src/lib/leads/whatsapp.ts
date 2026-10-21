import { site } from "@/config/site";
import type { InquiryStatus } from "@/types/database";

/*
 * WhatsApp link construction, kept OUT of the `"use server"` action module.
 *
 * A `"use server"` file may only export async functions — exporting these
 * synchronously would fail the build. They also need to be callable from client
 * components (the confirmation screen) and from the admin leads view, both of
 * which import them directly rather than round-tripping through an action.
 */

/**
 * Digits only, with a country code.
 *
 * Indonesian clients write numbers four different ways ("0812…", "+62 812…",
 * "62-812…", "62812…"). wa.me rejects anything but digits, and dropping the
 * leading zero is required when the country code is already present — get this
 * wrong and the follow-up button silently opens a chat with nobody.
 */
export function normaliseWhatsAppNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

export type LeadWhatsAppInput = {
  name: string;
  phone?: string | null;
  reference?: string | null;
  eventType?: string | null;
  eventDate?: string | null;
  packageName?: string | null;
  addonNames?: string[];
};

/**
 * Pre-filled WhatsApp greeting for a lead, used by both the client's
 * confirmation screen and the studio's "Chat on WhatsApp" quick action.
 *
 * `audience` changes the voice: the client writes *to* the studio, the studio
 * writes *to* the client. One builder keeps the wording consistent without
 * duplicating the number-normalisation and encoding logic twice.
 */
export function buildLeadWhatsAppLink(
  lead: LeadWhatsAppInput,
  audience: "client" | "studio",
): string {
  const studioNumber = site.whatsappNumber;

  if (audience === "client") {
    const lines = [
      `Halo ${site.name},`,
      "",
      `Saya *${lead.name}* baru saja mengirim permintaan konsultasi melalui website.`,
      lead.reference ? `Nomor referensi saya: *${lead.reference}*` : null,
      lead.eventType ? `Jenis acara: *${lead.eventType}*` : null,
      lead.eventDate ? `Tanggal acara: *${lead.eventDate}*` : null,
      lead.packageName ? `Paket yang saya minati: *${lead.packageName}*` : null,
      lead.addonNames?.length ? `Add-on pilihan: ${lead.addonNames.join(", ")}` : null,
      "",
      "Mohon info ketersediaan jadwal dan langkah selanjutnya. Terima kasih!",
    ].filter(Boolean);
    return `https://wa.me/${studioNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
  }

  const target = lead.phone ? normaliseWhatsAppNumber(lead.phone) : null;
  if (!target) return `https://wa.me/${studioNumber}`;

  const lines = [
    `Halo kak *${lead.name}*,`,
    "",
    `Terima kasih sudah menghubungi ${site.name}. Saya ingin menindaklanjuti permintaan konsultasi Anda${
      lead.reference ? ` (ref. ${lead.reference})` : ""
    }.`,
    lead.eventType ? `Jenis acara: ${lead.eventType}` : null,
    lead.eventDate ? `Tanggal acara: ${lead.eventDate}` : null,
    lead.packageName ? `Paket yang diminati: ${lead.packageName}` : null,
    "",
    "Apakah ada waktu untuk kita diskusikan detailnya?",
  ].filter(Boolean);

  return `https://wa.me/${target}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/**
 * The pipeline order the studio actually moves through.
 *
 * Lives here rather than in `admin-leads.ts` because a `"use server"` module
 * may only export async functions — exporting an array from it fails the build.
 * Both the action and the admin view need this order, so it belongs in shared
 * code.
 */
export const LEAD_STATUS_ORDER: InquiryStatus[] = [
  "NEW",
  "CONTACTED",
  "SCHEDULED",
  "CONVERTED",
  "LOST",
];

/** Human labels for the status chips and the row select. */
export const LEAD_STATUS_LABEL: Record<InquiryStatus, string> = {
  NEW: "Baru",
  CONTACTED: "Dihubungi",
  SCHEDULED: "Terjadwal",
  CONVERTED: "Jadi Proyek",
  LOST: "Batal",
  QUOTED: "Penawaran",
  ARCHIVED: "Arsip",
};
