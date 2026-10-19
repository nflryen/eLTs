"use server";

import { revalidatePath } from "next/cache";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * Crew Dual-Consent Action: allows a crew member using their dispatch magic token
 * to accept or decline an assigned production offer.
 * Strictly exports ONLY async functions per Next.js server actions contract.
 */
export async function respondToAssignmentOfferAction(
  magicToken: string,
  accept: boolean,
  declineReason?: string
): Promise<{ success: boolean; status?: string; message?: string; error?: string }> {
  if (!magicToken || typeof magicToken !== "string") {
    return {
      success: false,
      error: "INVALID_TOKEN",
      message: "Token penugasan tidak valid.",
    };
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase.rpc("respond_crew_assignment_offer", {
      p_magic_token: magicToken,
      p_accept: accept,
      p_declined_reason: declineReason?.trim() || null,
    });

    if (error) {
      console.error("Error executing respond_crew_assignment_offer RPC:", error);
      return {
        success: false,
        error: error.code || "RPC_ERROR",
        message: error.message || "Gagal memproses respon penugasan.",
      };
    }

    const payload = (data && typeof data === "object" ? data : {}) as {
      success?: boolean;
      status?: string;
      message?: string;
      error?: string;
    };

    revalidatePath(`/crew/${magicToken}`);

    return {
      success: !!payload.success,
      status: payload.status,
      message: payload.message,
      error: payload.error,
    };
  } catch (err: unknown) {
    console.error("Unexpected error in respondToAssignmentOfferAction:", err);
    return {
      success: false,
      error: "SERVER_ERROR",
      message: err instanceof Error ? err.message : "Terjadi kesalahan internal pada server.",
    };
  }
}
