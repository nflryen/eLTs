"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFounder } from "@/lib/auth/roles";
import type { MoneySplitRow } from "@/lib/finance/waterfall";

/**
 * TREASURY SPLITS — the studio-private waterfall, wired to the database RPC.
 *
 * WHY THIS FILE IS THIN
 * ---------------------
 * The dual-approval lifecycle (who may approve, what happens when BOTH founders
 * have approved, and the reserve inflow written to `cash_ledger` on full
 * approval) already lives in the Postgres function `public.approve_money_split`.
 * Reimplementing any of that here would create a second source of truth that
 * drifts the moment the SQL changes — so approval below is a single `.rpc`
 * call and nothing more.
 *
 * The ONLY arithmetic this module owns is the *initial* pass: turning gross
 * revenue and direct costs into net profit, a reserve, a closer commission, and
 * the two founder shares. That mirrors the seeded 40/35 intent and is written
 * to `money_splits` as a PENDING_APPROVAL row, keyed on `project_id`.
 */

// ── Validation ───────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();

const createInputSchema = z.object({
  projectId: z.string().uuid(),
  grossRevenue: z.number().finite().nonnegative(),
  directCosts: z.number().finite().nonnegative(),
  reservePct: z.number().finite().min(0).max(100),
  commissionPct: z.number().finite().min(0).max(100).optional(),
  closerName: z.string().trim().max(120).optional(),
});

const approveInputSchema = z.object({
  splitId: z.string().uuid(),
  founder: z.enum(["A", "B"]),
  projectId: z.string().uuid(),
});

const rejectInputSchema = z.object({
  splitId: z.string().uuid(),
  projectId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export type CreateOrUpdateSplitInput = z.input<typeof createInputSchema>;

export type SplitActionResult = {
  success: boolean;
  split?: MoneySplitRow;
  error?: string;
};

/**
 * Fetches the current split row for a project, or null when none exists yet.
 * The RAB panel calls this to render the waterfall cards and approval state.
 */
export async function getProjectSplit(
  projectId: string,
): Promise<{ success: boolean; split: MoneySplitRow | null; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, split: null, error: "Invalid project ID." };
    }

    const { data, error } = await supabase
      .from("money_splits")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    if (error) {
      return { success: false, split: null, error: error.message };
    }

    return { success: true, split: (data as MoneySplitRow | null) ?? null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load split.";
    return { success: false, split: null, error: message };
  }
}

/**
 * Creates or updates the waterfall split for a project.
 *
 * `money_splits.project_id` is UNIQUE, so this is a natural upsert keyed on the
 * project. Any change to the financial inputs resets BOTH approvals to false and
 * returns the row to PENDING_APPROVAL — an approved figure must never silently
 * carry over onto a different number.
 */
export async function createOrUpdateSplit(input: {
  projectId: string;
  grossRevenue: number;
  directCosts: number;
  reservePct: number;
  commissionPct?: number;
  closerName?: string;
}): Promise<SplitActionResult> {
  try {
    const { supabase } = await requireFounder();

    const parsed = createInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid split input.",
      };
    }

    const {
      projectId,
      grossRevenue,
      directCosts,
      reservePct,
      commissionPct = 0,
      closerName,
    } = parsed.data;

    // The project must exist before we hang a split off it.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError || !project) {
      return { success: false, error: "Referenced project does not exist." };
    }

    // ── Waterfall arithmetic (mirrors the seeded 40/35 intent) ──────────────
    const netProfit = Math.round(Math.max(0, grossRevenue - directCosts));
    const reserveAmount = Math.round((netProfit * reservePct) / 100);
    const commissionAmount = Math.round((netProfit * commissionPct) / 100);

    const distributable = Math.max(0, netProfit - reserveAmount - commissionAmount);

    // 40% to Founder A, 35% to Founder B. The remaining 25% stays undistributed
    // (studio/partner-gear pool). Any rounding remainder is folded into A so the
    // two shares plus the retained pool always reconstruct `distributable`.
    const founderAShare = Math.round((distributable * 40) / 100);
    const founderBShare = Math.round((distributable * 35) / 100);
    const withRemainderToA = founderAShare + (distributable - founderAShare - founderBShare);

    /*
     * Annotated against the row type. Without it the literal widens `status` to
     * `string`, which no longer matches `MoneySplitStatus` now that the client is
     * typed — the object would be accepted by the compiler but rejected by
     * PostgREST's overload resolution.
     */
    const payload: Partial<MoneySplitRow> & Pick<MoneySplitRow, "project_id" | "gross_revenue"> = {
      project_id: projectId,
      gross_revenue: Math.round(grossRevenue),
      direct_costs: Math.round(directCosts),
      net_profit: netProfit,
      reserve_pct: reservePct,
      reserve_amount: reserveAmount,
      commission_pct: commissionPct,
      commission_amount: commissionAmount,
      closer_name: closerName?.trim() ? closerName.trim() : null,
      founder_a_share: withRemainderToA,
      founder_b_share: founderBShare,
      approved_by_a: false,
      approved_by_b: false,
      status: "PENDING_APPROVAL",
      updated_at: new Date().toISOString(),
    };

    const { data: existing, error: existingError } = await supabase
      .from("money_splits")
      .select("id")
      .eq("project_id", projectId)
      .maybeSingle();

    if (existingError) {
      return { success: false, error: existingError.message };
    }

    const { data, error } = existing
      ? await supabase
          .from("money_splits")
          .update(payload)
          .eq("id", existing.id)
          .select()
          .single()
      : await supabase.from("money_splits").insert(payload).select().single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin/finance");

    return { success: true, split: data as MoneySplitRow };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save split.";
    return { success: false, error: message };
  }
}

/**
 * Records a founder's approval. Delegates entirely to the existing
 * `approve_money_split` RPC, which owns the dual-approval rule and writes the
 * reserve inflow to `cash_ledger` once BOTH founders have signed off.
 */
export async function approveSplit(
  splitId: string,
  founder: "A" | "B",
  projectId: string,
): Promise<SplitActionResult> {
  try {
    const { supabase } = await requireFounder();

    const parsed = approveInputSchema.safeParse({ splitId, founder, projectId });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid approval input.",
      };
    }

    const { error: rpcError } = await supabase.rpc("approve_money_split", {
      p_split_id: parsed.data.splitId,
      p_founder: parsed.data.founder,
    });

    if (rpcError) {
      return { success: false, error: rpcError.message };
    }

    revalidatePath(`/admin/projects/${parsed.data.projectId}`);
    revalidatePath("/admin/finance");

    // Re-read through the same authorized client so the caller gets the row the
    // RPC just wrote (approvals + any status transition).
    const { data: refreshed } = await supabase
      .from("money_splits")
      .select("*")
      .eq("project_id", parsed.data.projectId)
      .maybeSingle();

    return { success: true, split: (refreshed as MoneySplitRow | null) ?? undefined };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to approve split.";
    return { success: false, error: message };
  }
}

/**
 * Rejects a split outright: status becomes REJECTED and both approvals clear.
 */
export async function rejectSplit(
  splitId: string,
  projectId: string,
  reason?: string,
): Promise<SplitActionResult> {
  try {
    const { supabase } = await requireFounder();

    const parsed = rejectInputSchema.safeParse({ splitId, projectId, reason });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Invalid rejection input.",
      };
    }

    const { data, error } = await supabase
      .from("money_splits")
      .update({
        status: "REJECTED",
        approved_by_a: false,
        approved_by_b: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.data.splitId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/admin/projects/${parsed.data.projectId}`);
    revalidatePath("/admin/finance");

    return { success: true, split: data as MoneySplitRow };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to reject split.";
    return { success: false, error: message };
  }
}
