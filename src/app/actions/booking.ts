"use server";

import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import { syncStudioEventToGoogleCalendar } from "@/services/calendar/google";
import { site } from "@/config/site";
import type {
  BookingConfirmationDetails,
  BookingSlot,
} from "@/types/calendar";

const bookingFormSchema = z.object({
  eventType: z.enum(["DISCOVERY_CALL", "PRE_PRODUCTION"]),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid (YYYY-MM-DD)"),
  timeSlot: z.string().regex(/^\d{2}:\d{2}$/, "Format waktu tidak valid (HH:MM)"),
  fullName: z
    .string()
    .min(2, "Nama lengkap minimal 2 karakter")
    .max(160, "Nama maksimal 160 karakter"),
  whatsapp: z
    .string()
    .min(8, "Nomor WhatsApp minimal 8 digit")
    .max(32, "Nomor WhatsApp maksimal 32 karakter"),
  email: z
    .string()
    .email("Format email tidak valid")
    .max(254)
    .optional()
    .or(z.literal("")),
  servicePillar: z.enum([
    "Pictures Event/Graduation",
    "Broadcast Live Stream",
    "Digital Lab",
  ]),
  notes: z
    .string()
    .max(1000, "Catatan maksimal 1000 karakter")
    .optional()
    .or(z.literal("")),
});

type BookingFormData = z.infer<typeof bookingFormSchema>;

// Standard operating hours slots in WIB (UTC+7)
const DEFAULT_SLOTS = [
  "09:00",
  "10:00",
  "11:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
];

/**
 * Returns available slot times for a given date in WIB (UTC+7).
 * Blackouts slots that conflict with existing scheduled studio events or are in the past.
 */
export async function getAvailableSlots(
  dateStr: string,
  durationMinutes: number = 15
): Promise<{ success: boolean; slots: BookingSlot[]; error?: string }> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { success: false, slots: [], error: "Format tanggal tidak valid." };
    }

    const supabase = createServiceSupabase();

    // WIB day start and end in ISO format (+07:00)
    const dayStartIso = `${dateStr}T00:00:00+07:00`;
    const dayEndIso = `${dateStr}T23:59:59+07:00`;

    // Query non-cancelled events overlapping this calendar day
    const { data: existingEvents, error } = await supabase
      .from("studio_events")
      .select("id, start_time, end_time, status, title")
      .neq("status", "CANCELLED")
      .gte("end_time", dayStartIso)
      .lte("start_time", dayEndIso);

    if (error) {
      console.warn("[BookingAction] Warning fetching existing events:", error.message);
    }

    const eventsList = existingEvents || [];
    const now = new Date();

    const slots: BookingSlot[] = DEFAULT_SLOTS.map((timeStr) => {
      const startIso = `${dateStr}T${timeStr}:00+07:00`;
      const slotStartTime = new Date(startIso).getTime();
      const slotEndTime = slotStartTime + durationMinutes * 60 * 1000;
      const endIso = new Date(slotEndTime).toISOString();

      // Check if slot has already passed
      if (slotStartTime <= now.getTime()) {
        return {
          time: timeStr,
          startIso,
          endIso,
          available: false,
          conflictReason: "Waktu telah berlalu",
        };
      }

      // Check overlap with any existing scheduled event: (startA < endB && endA > startB)
      const hasConflict = eventsList.some((evt) => {
        const evtStart = new Date(evt.start_time).getTime();
        const evtEnd = new Date(evt.end_time).getTime();
        return slotStartTime < evtEnd && slotEndTime > evtStart;
      });

      if (hasConflict) {
        return {
          time: timeStr,
          startIso,
          endIso,
          available: false,
          conflictReason: "Sudah terisi",
        };
      }

      return {
        time: timeStr,
        startIso,
        endIso,
        available: true,
      };
    });

    return { success: true, slots };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[BookingAction] Failed to compute available slots:", message);
    return {
      success: false,
      slots: [],
      error: "Gagal memuat jadwal yang tersedia.",
    };
  }
}

/**
 * Books a studio event, generates Google Meet link via Google Calendar integration,
 * persists the event to public.studio_events, and prepares instant WhatsApp follow-up.
 */
export async function bookStudioEventAction(data: BookingFormData): Promise<{
  success: boolean;
  confirmation?: BookingConfirmationDetails;
  error?: string;
}> {
  try {
    const validated = bookingFormSchema.parse(data);
    const supabase = createServiceSupabase();

    const durationMinutes =
      validated.eventType === "DISCOVERY_CALL" ? 15 : 45;

    const startIso = `${validated.date}T${validated.timeSlot}:00+07:00`;
    const startTimeMs = new Date(startIso).getTime();
    const endTimeMs = startTimeMs + durationMinutes * 60 * 1000;
    const endIso = new Date(endTimeMs).toISOString();

    // Check past time
    if (startTimeMs <= Date.now()) {
      return {
        success: false,
        error: "Waktu yang dipilih sudah berlalu. Silakan pilih waktu yang akan datang.",
      };
    }

    // Verify slot is not already taken (prevent concurrent race bookings)
    const { data: conflicts } = await supabase
      .from("studio_events")
      .select("id")
      .neq("status", "CANCELLED")
      .lt("start_time", endIso)
      .gt("end_time", startIso);

    if (conflicts && conflicts.length > 0) {
      return {
        success: false,
        error:
          "Slot waktu ini baru saja direservasi. Silakan pilih jam atau tanggal lainnya.",
      };
    }

    const typeTitle =
      validated.eventType === "DISCOVERY_CALL"
        ? "15-min Discovery Call"
        : "45-min Technical & Creative Briefing";

    const title = `${typeTitle} - ${validated.fullName.trim()}`;

    // 1. Sync with Google Calendar service & generate Google Meet link
    const gcalResult = await syncStudioEventToGoogleCalendar({
      title,
      event_type: validated.eventType,
      client_name: validated.fullName.trim(),
      client_phone: validated.whatsapp.trim(),
      client_email: validated.email?.trim() || null,
      service_interest: validated.servicePillar,
      start_time: startIso,
      end_time: endIso,
      notes: validated.notes?.trim() || null,
    });

    // 2. Insert into public.studio_events
    const { data: insertedEvent, error: insertError } = await supabase
      .from("studio_events")
      .insert({
        title,
        event_type: validated.eventType,
        client_name: validated.fullName.trim(),
        client_phone: validated.whatsapp.trim(),
        client_email: validated.email?.trim() || null,
        service_interest: validated.servicePillar,
        start_time: startIso,
        end_time: endIso,
        google_event_id: gcalResult.eventId,
        meet_link: gcalResult.meetLink,
        notes: validated.notes?.trim() || null,
        status: "SCHEDULED",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("[BookingAction] Error inserting studio_event:", insertError);
      throw new Error(`Gagal menyimpan jadwal meeting: ${insertError.message}`);
    }

    const eventId = insertedEvent?.id || gcalResult.eventId;

    // 3. Prepare direct WhatsApp follow-up link
    const waText = encodeURIComponent(
      `*Halo ELTs. Studio Purwokerto,*\n\n` +
        `Saya telah menjadwalkan sesi meeting:\n` +
        `• *Nama:* ${validated.fullName}\n` +
        `• *Sesi:* ${typeTitle}\n` +
        `• *Tanggal:* ${validated.date}\n` +
        `• *Waktu:* ${validated.timeSlot} WIB\n` +
        `• *Layanan:* ${validated.servicePillar}\n` +
        (gcalResult.meetLink ? `• *Google Meet:* ${gcalResult.meetLink}\n` : "") +
        `\nMohon konfirmasi jadwalnya ya kak. Terima kasih!`
    );

    const waNumber = site.whatsappNumber || "6285128015848";
    const waLink = `https://wa.me/${waNumber}?text=${waText}`;

    return {
      success: true,
      confirmation: {
        eventId,
        title,
        clientName: validated.fullName.trim(),
        clientPhone: validated.whatsapp.trim(),
        clientEmail: validated.email?.trim() || null,
        serviceInterest: validated.servicePillar,
        startTime: startIso,
        endTime: endIso,
        meetLink: gcalResult.meetLink,
        waLink,
      },
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Terjadi kesalahan saat memproses jadwal.";
    console.error("[BookingAction] Exception in bookStudioEventAction:", err);
    return {
      success: false,
      error: message,
    };
  }
}
