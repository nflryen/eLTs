/**
 * Client reminder composition.
 *
 * Every reminder is composed on the SERVER from the project record so the
 * operator only reviews and confirms - they never retype details. Two rules
 * drive the design:
 *
 *   1. Fail closed. If a required datum (venue map link, payment account) is
 *      null we return the field name in `missing` and refuse to produce a
 *      message. A half-filled reminder that tells a client to "meet at the
 *      venue" with no address is worse than no reminder.
 *
 *   2. No hardcoded PII. Phone numbers, bank accounts, and studio identity all
 *      come from the database. Nothing in this file is customer-specific.
 */

import { buildWhatsAppLink, normalisePhone } from "@/lib/whatsapp/phone";

export const REMINDER_KINDS = [
  "T_MINUS_7_PREP",
  "T_MINUS_1_CALLSHEET",
  "SHOOT_DAY_ONSITE",
  "GALLERY_READY",
  "PAYMENT_DP",
  "PAYMENT_FINAL",
  "PAYMENT_OVERDUE",
  "SELECTION_REMINDER",
] as const;

export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** A bank account offered to the client, read from studio_payment_methods. */
export type PaymentMethod = {
  bank_name: string;
  account_number: string;
  account_holder: string;
  label: string | null;
};

/** Project data the composer needs. All fields are nullable on purpose. */
export type ReminderProject = {
  name: string;
  client_name: string | null;
  client_phone: string | null;
  shoot_date: string | null;
  call_time: string | null;
  venue_name: string | null;
  venue_address: string | null;
  /** Google Maps / Apple Maps link. Required for every shoot reminder. */
  venue_maps_url: string | null;
  gallery_url: string | null;
  selection_deadline: string | null;
  /** Crew on the job, for the callsheet contact block. */
  crew_contacts: Array<{ name: string; role: string; phone: string | null }> | null;
};

export type ReminderInvoice = {
  invoice_number: string;
  amount_due: number;
  due_date: string | null;
};

export type ReminderContext = {
  project: ReminderProject;
  invoice?: ReminderInvoice | null;
  paymentMethods?: PaymentMethod[];
  studioName: string;
};

export type ComposedReminder = {
  kind: ReminderKind;
  /** Message body ready to paste into WhatsApp. Empty when `missing` is set. */
  message: string;
  /** `wa.me` link, or null when the phone is unusable or fields are missing. */
  waUrl: string | null;
  /** Normalised recipient, or null when the phone could not be parsed. */
  targetPhone: string | null;
  /** Field names the operator must fill before this can be sent. */
  missing: string[];
};

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

/**
 * Format an ISO date as an Indonesian long date.
 * Deliberately timezone-free: a shoot on the 14th is the 14th regardless of
 * where the server runs, so we never call `new Date()` on a date-only string.
 */
export function formatDateId(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const monthName = MONTHS_ID[Number(month) - 1];
  if (!monthName) return null;
  return `${Number(day)} ${monthName} ${year}`;
}

/** Rupiah formatting without locale dependence. */
export function formatRupiah(amount: number): string {
  return `Rp${Math.round(amount).toLocaleString("id-ID")}`;
}

function missingOf(...pairs: Array<[string, unknown]>): string[] {
  return pairs.filter(([, value]) => value === null || value === undefined || value === "").map(([key]) => key);
}

/**
 * Compose one reminder. Returns `missing` non-empty and an empty message when
 * any required field is absent; callers must surface those fields rather than
 * dispatching.
 */
export function composeReminder(kind: ReminderKind, ctx: ReminderContext): ComposedReminder {
  const { project, invoice, paymentMethods = [], studioName } = ctx;

  const phone = normalisePhone(project.client_phone);
  const targetPhone = phone.ok ? phone.phone.e164 : null;
  const missing: string[] = [];
  if (!phone.ok) missing.push("client_phone");

  const lines: string[] = [];
  const greeting = project.client_name ? `Halo ${project.client_name},` : "Halo,";
  const dateId = formatDateId(project.shoot_date);

  const paymentBlock = () => {
    if (paymentMethods.length === 0) {
      missing.push("payment_methods");
      return [];
    }
    const out = ["", "Pembayaran dapat ditransfer ke:"];
    for (const m of paymentMethods) {
      out.push(`• ${m.bank_name} ${m.account_number}`);
      out.push(`  a/n ${m.account_holder}${m.label ? ` (${m.label})` : ""}`);
    }
    return out;
  };

  switch (kind) {
    case "T_MINUS_7_PREP": {
      missing.push(...missingOf(["shoot_date", dateId], ["venue_name", project.venue_name], ["venue_maps_url", project.venue_maps_url]));
      lines.push(greeting, "", `Acara *${project.name}* akan dilaksanakan pada *${dateId ?? "-"}*.`);
      lines.push("Berikut hal yang perlu disiapkan:", "• Konfirmasi jumlah tamu/peserta", "• Daftar momen penting yang wajib diambil", "• Kontak penanggung jawab di lokasi");
      lines.push("", `Lokasi: ${project.venue_name ?? "-"}`);
      if (project.venue_maps_url) lines.push(project.venue_maps_url);
      break;
    }
    case "T_MINUS_1_CALLSHEET": {
      missing.push(...missingOf(
        ["shoot_date", dateId], ["call_time", project.call_time],
        ["venue_name", project.venue_name], ["venue_address", project.venue_address],
        ["venue_maps_url", project.venue_maps_url],
      ));
      lines.push(greeting, "", `Besok jadwal *${project.name}*. Berikut call sheet-nya:`, "");
      lines.push(`📅 Tanggal: ${dateId ?? "-"}`);
      lines.push(`⏰ Waktu: ${project.call_time ?? "-"}`);
      lines.push(`📍 Lokasi: ${project.venue_name ?? "-"}`);
      lines.push(project.venue_address ?? "-");
      if (project.venue_maps_url) lines.push(`🗺️ Peta: ${project.venue_maps_url}`);
      if (project.crew_contacts && project.crew_contacts.length > 0) {
        lines.push("", "Kontak kru yang bertugas:");
        for (const c of project.crew_contacts) {
          const crewPhone = normalisePhone(c.phone);
          lines.push(`• ${c.name} — ${c.role}${crewPhone.ok ? ` (${crewPhone.phone.e164})` : ""}`);
        }
      }
      break;
    }
    case "SHOOT_DAY_ONSITE": {
      missing.push(...missingOf(["venue_name", project.venue_name], ["venue_maps_url", project.venue_maps_url]));
      lines.push(greeting, "", `Tim kami sedang dalam perjalanan ke lokasi *${project.name}*.`);
      lines.push(`📍 ${project.venue_name ?? "-"}`);
      if (project.venue_maps_url) lines.push(project.venue_maps_url);
      lines.push("", "Silakan hubungi kami bila ada perubahan akses atau lokasi.");
      break;
    }
    case "GALLERY_READY": {
      missing.push(...missingOf(["gallery_url", project.gallery_url]));
      lines.push(greeting, "", `Hasil foto *${project.name}* sudah siap dilihat.`);
      if (project.gallery_url) lines.push(`Galeri: ${project.gallery_url}`);
      lines.push("", "Silakan pilih foto favorit Anda melalui tautan di atas.");
      break;
    }
    case "SELECTION_REMINDER": {
      missing.push(...missingOf(["gallery_url", project.gallery_url], ["selection_deadline", project.selection_deadline]));
      const deadline = formatDateId(project.selection_deadline);
      lines.push(greeting, "", `Pengingat pemilihan foto untuk *${project.name}*.`);
      if (deadline) lines.push(`Batas pemilihan: *${deadline}*.`);
      if (project.gallery_url) lines.push(`Galeri: ${project.gallery_url}`);
      break;
    }
    case "PAYMENT_DP":
    case "PAYMENT_FINAL":
    case "PAYMENT_OVERDUE": {
      missing.push(...missingOf(["invoice_number", invoice?.invoice_number], ["amount_due", invoice?.amount_due]));
      const label = kind === "PAYMENT_DP" ? "DP" : kind === "PAYMENT_FINAL" ? "pelunasan" : "tagihan";
      lines.push(greeting, "", `Berikut ${label} untuk *${project.name}*:`);
      if (invoice) {
        const due = formatDateId(invoice.due_date);
        lines.push(`No. Invoice: ${invoice.invoice_number}`);
        lines.push(`Jumlah: *${formatRupiah(invoice.amount_due)}*`);
        if (due) lines.push(`Jatuh tempo: ${due}`);
        if (kind === "PAYMENT_OVERDUE") lines.push("", "Mohon maaf, pembayaran telah melewati jatuh tempo. Kami akan sangat berterima kasih atas konfirmasinya.");
      }
      lines.push(...paymentBlock());
      break;
    }
    default: {
      // Exhaustiveness guard: adding a kind without a template is a type error.
      const never: never = kind;
      throw new Error(`Unhandled reminder kind: ${String(never)}`);
    }
  }

  lines.push("", `Terima kasih,\n${studioName}`);

  // Fail closed: a missing field suppresses the message entirely.
  if (missing.length > 0) {
    return { kind, message: "", waUrl: null, targetPhone, missing };
  }

  const message = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const waUrl = targetPhone ? buildWhatsAppLink(targetPhone, message) : null;
  return { kind, message, waUrl, targetPhone, missing: [] };
}

/**
 * Which reminders are actionable for a project right now. Used by the admin
 * header dropdown so the operator sees R1-R5 without guessing timing.
 */
export function suggestedReminderKinds(
  project: Pick<ReminderProject, "shoot_date" | "gallery_url" | "selection_deadline">,
  todayIso: string
): ReminderKind[] {
  const out: ReminderKind[] = [];
  if (project.shoot_date) {
    const days = Math.round(
      (Date.parse(`${project.shoot_date}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / 86_400_000
    );
    if (days === 7) out.push("T_MINUS_7_PREP");
    if (days === 1) out.push("T_MINUS_1_CALLSHEET");
    if (days === 0) out.push("SHOOT_DAY_ONSITE");
  }
  if (project.gallery_url) {
    out.push("GALLERY_READY");
    if (project.selection_deadline) out.push("SELECTION_REMINDER");
  }
  return out;
}
