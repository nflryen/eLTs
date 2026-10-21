"use server";

import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { InquiryAddon, InquiryRow } from "@/types/database";
import { buildLeadWhatsAppLink } from "@/lib/leads/whatsapp";

/*
 * Public-facing submission contract.
 *
 * Everything except name/phone/message is optional because the contact form and
 * the pricelist configurator are different entry points: the former collects
 * little, the latter already knows the package and add-ons. One schema serves
 * both, so a lead captured from /pricelist arrives with its commercial context
 * attached and the studio never has to re-ask.
 */
const addonSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  price_idr: z.number().int().min(0).max(1_000_000_000),
});

const inquirySchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(160, "Nama maksimal 160 karakter"),
  brandName: z.string().max(160).optional().or(z.literal("")),
  phone: z
    .string()
    .min(8, "Nomor WhatsApp tidak valid")
    .max(32, "Nomor WhatsApp maksimal 32 karakter"),
  email: z.string().email("Format email tidak valid").max(254).optional().or(z.literal("")),
  pillar: z.string().min(1, "Pilih bidang layanan").max(64),
  budgetRange: z.string().max(64).optional().or(z.literal("")),
  message: z
    .string()
    .min(10, "Ceritakan kebutuhanmu minimal 10 karakter")
    .max(2000, "Cerita maksimal 2000 karakter"),
  sourcePage: z.string().max(200).optional().or(z.literal("")),
  eventType: z.string().max(64).optional().or(z.literal("")),
  /* `date` input yields "YYYY-MM-DD"; empty string means "not decided yet". */
  eventDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal tidak valid")
    .optional()
    .or(z.literal("")),
  selectedPackageId: z.string().uuid().optional().or(z.literal("")),
  selectedAddons: z.array(addonSchema).max(20).optional(),
});

export type InquiryFormValues = z.input<typeof inquirySchema>;

export type SubmitInquiryResult =
  | { success: true; reference: string; inquiryId: string; waLink: string }
  | { success: false; error: string };

export async function submitInquiryAction(
  data: InquiryFormValues,
): Promise<SubmitInquiryResult> {
  try {
    const validated = inquirySchema.parse(data);
    const supabase = createServiceSupabase();

    /*
     * Annotated so `status` stays the enum union rather than widening to
     * `string`, which the typed insert overload rejects.
     */
    const insertPayload: Pick<InquiryRow, "name" | "phone" | "pillar" | "message"> &
      Partial<Omit<InquiryRow, "name" | "phone" | "pillar" | "message">> = {
      name: validated.name.trim(),
      brand_name: validated.brandName?.trim() || null,
      phone: validated.phone.trim(),
      email: validated.email?.trim() || null,
      pillar: validated.pillar.trim(),
      budget_range: validated.budgetRange?.trim() || null,
      message: validated.message.trim(),
      source_page: validated.sourcePage?.trim() || "/contact",
      status: "NEW",
      event_type: validated.eventType?.trim() || null,
      event_date: validated.eventDate || null,
      selected_package_id: validated.selectedPackageId || null,
      selected_addons: (validated.selectedAddons ?? []) as InquiryAddon[],
    };

    /*
     * `reference` is assigned by the 0027 trigger, so it must be read back —
     * the client is shown this value and quotes it on WhatsApp.
     */
    const { data: inserted, error } = await supabase
      .from("inquiries")
      .insert(insertPayload)
      .select("id, reference")
      .single();

    if (error) {
      console.error("Database error saving inquiry:", error);
      return { success: false, error: "Gagal menyimpan permintaan. Silakan coba lagi." };
    }

    const waLink = buildLeadWhatsAppLink(
      {
        name: validated.name.trim(),
        phone: validated.phone,
        reference: inserted.reference,
        eventType: validated.eventType || null,
        eventDate: validated.eventDate || null,
        addonNames: (validated.selectedAddons ?? []).map((a) => a.name),
      },
      "client",
    );

    return {
      success: true,
      reference: inserted.reference ?? "",
      inquiryId: inserted.id,
      waLink,
    };
  } catch (error: unknown) {
    /*
     * Zod issues are the only errors a client can act on, so surface the first
     * one verbatim; everything else is a server fault and must not leak
     * internals into a public form.
     */
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0]?.message ?? "Data tidak valid." };
    }
    console.error("Failed to submit inquiry:", error);
    return { success: false, error: "Gagal mengirimkan pesan. Silakan coba lagi." };
  }
}
