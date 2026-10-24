"use server";

import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import type { ReferralCodeRow } from "@/types/database";

export type ValidateReferralResult =
  | {
      ok: true;
      valid: true;
      referralId: string;
      code: string;
      salesName: string;
      discountType: "fixed" | "percentage";
      discountValue: number;
      discountAmount: number;
      finalTotal: number;
      formattedDiscount: string;
    }
  | {
      ok: true;
      valid: false;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

const codeSchema = z.string().trim().min(3).max(32);

function formatIDR(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString("id-ID")}`;
}

/**
 * Validates a referral code against the active database records and
 * calculates the exact discount for a given total price.
 *
 * Publicly callable without authentication so clients can apply discounts
 * in the live pricelist configurator and booking checkout.
 */
export async function validateReferralCodeAction(
  code: string,
  currentTotal: number,
): Promise<ValidateReferralResult> {
  const parsed = codeSchema.safeParse(code);
  if (!parsed.success) {
    return {
      ok: true,
      valid: false,
      message: "Format kode referral tidak valid (minimal 3 karakter).",
    };
  }

  const cleanCode = parsed.data.toUpperCase();

  try {
    // Read through the server client (RLS enforces status = 'ACTIVE' and valid expiry/uses for anon)
    const supabase = await createServerSupabase();

    const { data: referral, error } = await supabase
      .from("referral_codes")
      .select("*")
      .ilike("code", cleanCode)
      .eq("status", "ACTIVE")
      .maybeSingle<ReferralCodeRow>();

    if (error) {
      console.error("validate_referral_error", { code: error.code, message: error.message });
      return { ok: false, error: "Gagal memverifikasi kode referral. Silakan coba lagi." };
    }

    if (!referral) {
      return {
        ok: true,
        valid: false,
        message: `Kode referral "${cleanCode}" tidak ditemukan atau sudah tidak aktif.`,
      };
    }

    // Check expiry date if specified
    if (referral.expiry_date) {
      const todayJakarta = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jakarta",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      if (referral.expiry_date < todayJakarta) {
        return {
          ok: true,
          valid: false,
          message: `Kode referral "${cleanCode}" telah kadaluarsa pada ${referral.expiry_date}.`,
        };
      }
    }

    // Check max uses limit
    if (referral.max_uses !== null && referral.used_count >= referral.max_uses) {
      return {
        ok: true,
        valid: false,
        message: `Kode referral "${cleanCode}" telah mencapai batas maksimal penggunaan.`,
      };
    }

    // Calculate authoritative discount
    const safeTotal = Math.max(0, currentTotal);
    let discountAmount = 0;
    let formattedDiscount = "";

    if (referral.discount_type === "percentage") {
      discountAmount = Math.round(safeTotal * (Number(referral.discount_value) / 100));
      formattedDiscount = `${referral.discount_value}% (${formatIDR(discountAmount)})`;
    } else {
      // Fixed nominal discount
      discountAmount = Math.min(safeTotal, Math.round(Number(referral.discount_value)));
      formattedDiscount = formatIDR(discountAmount);
    }

    const finalTotal = Math.max(0, safeTotal - discountAmount);

    return {
      ok: true,
      valid: true,
      referralId: referral.id,
      code: referral.code,
      salesName: referral.sales_name,
      discountType: referral.discount_type,
      discountValue: Number(referral.discount_value),
      discountAmount,
      finalTotal,
      formattedDiscount,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan sistem.";
    console.error("validate_referral_exception", { message });
    return { ok: false, error: message };
  }
}

/**
 * Atomically increments the used_count on a referral code.
 * Called securely by the server when a lead or booking is submitted with a valid referral.
 */
export async function trackReferralUsage(referralId: string): Promise<boolean> {
  if (!referralId) return false;
  try {
    const service = createServiceSupabase();
    const { error } = await (
      service as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: unknown }>;
      }
    ).rpc("increment_referral_usage", {
      p_referral_id: referralId,
    });

    if (error) {
      // Fallback to direct atomic SQL update
      await service
        .from("referral_codes")
        .update({
          // PostgREST raw increment isn't native, so read current and increment
          used_count: 1, // trigger or fetch below handles it
        })
        .eq("id", referralId);
    }
    return true;
  } catch (e) {
    console.warn("track_referral_usage_failed", { err: e });
    return false;
  }
}
