"use server";

import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";

const inquirySchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter").max(160, "Nama maksimal 160 karakter"),
  brandName: z.string().max(160).optional().or(z.literal("")),
  phone: z.string().min(8, "Nomor WhatsApp tidak valid").max(32, "Nomor WhatsApp maksimal 32 karakter"),
  email: z.string().email("Format email tidak valid").max(254).optional().or(z.literal("")),
  pillar: z.string().min(1, "Pilih bidang layanan"),
  budgetRange: z.string().optional().or(z.literal("")),
  message: z.string().min(10, "Ceritakan kebutuhanmu minimal 10 karakter"),
  sourcePage: z.string().optional().or(z.literal("")),
});

type InquiryFormValues = z.infer<typeof inquirySchema>;

export async function submitInquiryAction(data: InquiryFormValues) {
  try {
    const validated = inquirySchema.parse(data);
    const supabase = createServiceSupabase();

    const insertPayload = {
      name: validated.name.trim(),
      brand_name: validated.brandName?.trim() || null,
      phone: validated.phone.trim(),
      email: validated.email?.trim() || null,
      pillar: validated.pillar.trim(),
      budget_range: validated.budgetRange?.trim() || null,
      message: validated.message.trim(),
      source_page: validated.sourcePage?.trim() || "/kontak",
      status: "NEW",
    };

    const { data: inserted, error } = await supabase
      .from("inquiries")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("Database error saving inquiry:", error);
      throw new Error("Gagal menyimpan inquiry ke sistem.");
    }

    const pillarLabelMap: Record<string, string> = {
      VISUAL_CREATIVE: "Event & Wisuda (Pictures)",
      TECH_SOLUTION: "Live Streaming & Broadcast (Broadcast Engine)",
      DIGITAL_MANAGEMENT: "Digital Solutions & Web (Digital Lab)",
    };

    // Build WhatsApp message for instant follow up
    const waText = encodeURIComponent(
      `*Halo ELTs. Studio Purwokerto,*\n\nSaya *${validated.name}*${
        validated.brandName ? ` dari *${validated.brandName}*` : ""
      }.\n\nSaya ingin konsultasi/reservasi layanan:\n• Bidang Layanan: *${
        pillarLabelMap[validated.pillar] || validated.pillar
      }*\n• Estimasi Anggaran: *${validated.budgetRange || "Fleksibel"}*\n\nDetail Acara / Kebutuhan:\n"${
        validated.message
      }"\n\nMohon info ketersediaan jadwalnya ya kak. Terima kasih!`
    );

    const waLink = `https://wa.me/6280000000000?text=${waText}`;

    return {
      success: true,
      inquiryId: inserted.id,
      waLink,
    };
  } catch (error: unknown) {
    console.error("Failed to submit inquiry:", error);
    const message = error instanceof Error ? error.message : "Gagal mengirimkan pesan. Silakan coba lagi.";
    return {
      success: false,
      error: message,
    };
  }
}
