"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import type { ReferralCodeRow, ReferralDiscountType, ReferralStatus } from "@/types/database";

export type ReferralResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const codeRegex = /^[A-Z0-9_-]{3,32}$/;

const referralInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    code: z
      .string()
      .trim()
      .min(3, "Kode referral minimal 3 karakter.")
      .max(32, "Kode referral maksimal 32 karakter.")
      .transform((c) => c.toUpperCase())
      .refine((c) => codeRegex.test(c), {
        message: "Kode hanya boleh berisi huruf kapital, angka, tanda hubung (-), dan garis bawah (_).",
      }),
    salesName: z
      .string()
      .trim()
      .min(2, "Nama sales/partner minimal 2 karakter.")
      .max(160, "Nama sales/partner maksimal 160 karakter."),
    discountType: z.enum(["fixed", "percentage"], {
      error: "Tipe diskon harus 'fixed' (nominal) atau 'percentage' (persen).",
    }),
    discountValue: z.number().positive("Nilai diskon harus lebih besar dari 0."),
    maxUses: z.number().int().positive("Batas penggunaan harus bilangan bulat positif.").nullable().optional(),
    expiryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal kadaluarsa harus YYYY-MM-DD.")
      .nullable()
      .optional()
      .or(z.literal("")),
    status: z.enum(["ACTIVE", "DISABLED", "EXPIRED"]).default("ACTIVE"),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (data) => {
      if (data.discountType === "percentage") {
        return data.discountValue <= 100;
      }
      return true;
    },
    {
      message: "Diskon persentase tidak boleh melebihi 100%.",
      path: ["discountValue"],
    },
  );

export type ReferralFormValues = z.input<typeof referralInputSchema>;

// ── Reads ───────────────────────────────────────────────────────────────────

/** Lists all referral codes for the admin dashboard. */
export async function listReferralCodes(): Promise<ReferralCodeRow[]> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("referral_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("list_referral_codes_failed", { error });
    throw new Error(`Gagal memuat kode referral: ${error.message}`);
  }

  return (data ?? []) as ReferralCodeRow[];
}

// ── Writes ───────────────────────────────────────────────────────────────────

/** Creates or updates a referral code. */
export async function saveReferralCode(
  input: ReferralFormValues,
): Promise<ReferralResult<ReferralCodeRow>> {
  const { supabase } = await requireOps();

  const parsed = referralInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Data referral tidak valid." };
  }

  const val = parsed.data;

  const patch = {
    code: val.code,
    sales_name: val.salesName,
    discount_type: val.discountType as ReferralDiscountType,
    discount_value: val.discountValue,
    max_uses: val.maxUses ?? null,
    expiry_date: val.expiryDate ? val.expiryDate : null,
    status: val.status as ReferralStatus,
    notes: val.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  const query = val.id
    ? supabase.from("referral_codes").update(patch).eq("id", val.id).select("*").maybeSingle()
    : supabase.from("referral_codes").insert(patch).select("*").maybeSingle();

  const { data, error } = await query;

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Kode referral "${val.code}" sudah digunakan. Gunakan kode yang unik.` };
    }
    console.error("save_referral_failed", { error });
    return { ok: false, error: `Gagal menyimpan kode referral: ${error.message}` };
  }

  if (!data) return { ok: false, error: "Data kode referral tidak ditemukan." };

  revalidatePath("/admin/referrals");
  revalidatePath("/pricelist");
  return { ok: true, data: data as ReferralCodeRow };
}

/** Toggles status between ACTIVE and DISABLED. */
export async function toggleReferralCodeStatus(
  id: string,
  newStatus: ReferralStatus,
): Promise<ReferralResult<ReferralCodeRow>> {
  const { supabase } = await requireOps();

  const { data, error } = await supabase
    .from("referral_codes")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    return { ok: false, error: `Gagal mengubah status: ${error.message}` };
  }
  if (!data) return { ok: false, error: "Kode referral tidak ditemukan." };

  revalidatePath("/admin/referrals");
  revalidatePath("/pricelist");
  return { ok: true, data: data as ReferralCodeRow };
}

/**
 * Deletes a referral code.
 * Refuses deletion if the code has already been redeemed (used_count > 0) to preserve financial and audit integrity.
 */
export async function deleteReferralCode(id: string): Promise<ReferralResult> {
  const { supabase } = await requireOps();

  const { data: existing, error: readError } = await supabase
    .from("referral_codes")
    .select("used_count, code")
    .eq("id", id)
    .maybeSingle();

  if (readError) return { ok: false, error: `Gagal membaca kode: ${readError.message}` };
  if (!existing) return { ok: false, error: "Kode referral tidak ditemukan." };

  if (existing.used_count > 0) {
    return {
      ok: false,
      error: `Kode "${existing.code}" sudah pernah digunakan sebanyak ${existing.used_count} kali. Nonaktifkan kode alih-alih menghapusnya agar riwayat audit tetap terjaga.`,
    };
  }

  const { error } = await supabase.from("referral_codes").delete().eq("id", id);
  if (error) return { ok: false, error: `Gagal menghapus kode: ${error.message}` };

  revalidatePath("/admin/referrals");
  revalidatePath("/pricelist");
  return { ok: true };
}
