"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFounder } from "@/lib/auth/roles";
import {
  calculateWaterfallSplit,
  type MoneySplitRow,
  type CashLedgerRow,
  type CashLedgerType,
  type CashLedgerCategory,
  type ProjectSplitInput,
  type FinanceOverviewData,
} from "@/lib/finance/waterfall";

const uuidSchema = z.string().uuid();

/**
 * Creates or updates a waterfall profit split for a project.
 * Supports positional args: (projectId, grossRevenue, directCosts, commissionPct, closerName)
 * or a single options object: ({ projectId, grossRevenue, ... })
 */
export async function createOrUpdateProjectSplit(
  projectIdOrInput: string | ProjectSplitInput,
  grossRevenueParam?: number,
  directCostsParam?: number,
  commissionPctParam?: number,
  closerNameParam?: string | null
): Promise<{ success: boolean; split?: MoneySplitRow; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    let projectId: string;
    let grossRevenue: number;
    let directCosts: number = 0;
    let commissionPct: number = 0;
    let closerName: string | null = null;

    if (typeof projectIdOrInput === "object" && projectIdOrInput !== null) {
      projectId = projectIdOrInput.projectId;
      grossRevenue = Number(projectIdOrInput.grossRevenue);
      directCosts = Number(projectIdOrInput.directCosts || 0);
      commissionPct = Number(projectIdOrInput.commissionPct || 0);
      closerName = projectIdOrInput.closerName ?? null;
    } else {
      projectId = projectIdOrInput;
      grossRevenue = Number(grossRevenueParam);
      directCosts = Number(directCostsParam || 0);
      commissionPct = Number(commissionPctParam || 0);
      closerName = closerNameParam ?? null;
    }

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid project ID." };
    }

    if (isNaN(grossRevenue) || grossRevenue < 0) {
      return { success: false, error: "Gross revenue must be a non-negative number." };
    }

    if (isNaN(directCosts) || directCosts < 0) {
      return { success: false, error: "Direct costs must be a non-negative number." };
    }

    if (isNaN(commissionPct) || commissionPct < 0 || commissionPct > 100) {
      return { success: false, error: "Commission percentage must be between 0 and 100." };
    }

    // Verify project exists
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, contract_value")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return { success: false, error: "Referenced project does not exist." };
    }

    // Calculate waterfall split
    const calculation = calculateWaterfallSplit({
      grossRevenue,
      directCosts,
      reservePct: 5.0,
      commissionPct,
      closerName,
    });

    // Check if a split already exists for this project
    const { data: existingSplit } = await supabase
      .from("money_splits")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    let resultSplit: MoneySplitRow;

    if (existingSplit) {
      const { data: updated, error: updateError } = await supabase
        .from("money_splits")
        .update({
          gross_revenue: calculation.grossRevenue,
          direct_costs: calculation.directCosts,
          net_profit: calculation.netProfit,
          reserve_pct: calculation.reservePct,
          reserve_amount: calculation.reserveAmount,
          commission_pct: calculation.commissionPct,
          commission_amount: calculation.commissionAmount,
          closer_name: calculation.closerName,
          founder_a_share: calculation.founderAShare,
          founder_b_share: calculation.founderBShare,
          // Reset approvals if figures changed, or keep status consistent
          status: "PENDING_APPROVAL",
          approved_by_a: false,
          approved_by_b: false,
          updated_at: new Date().toISOString(),
        } as unknown as Record<string, unknown>)
        .eq("id", existingSplit.id)
        .select()
        .single();

      if (updateError) {
        return { success: false, error: `Failed to update split: ${updateError.message}` };
      }
      resultSplit = updated as MoneySplitRow;
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("money_splits")
        .insert({
          project_id: projectId,
          gross_revenue: calculation.grossRevenue,
          direct_costs: calculation.directCosts,
          net_profit: calculation.netProfit,
          reserve_pct: calculation.reservePct,
          reserve_amount: calculation.reserveAmount,
          commission_pct: calculation.commissionPct,
          commission_amount: calculation.commissionAmount,
          closer_name: calculation.closerName,
          founder_a_share: calculation.founderAShare,
          founder_b_share: calculation.founderBShare,
          approved_by_a: false,
          approved_by_b: false,
          status: "DRAFT",
        } as unknown as Record<string, unknown>)
        .select()
        .single();

      if (insertError) {
        return { success: false, error: `Failed to create split: ${insertError.message}` };
      }
      resultSplit = inserted as MoneySplitRow;
    }

    revalidatePath("/admin/finance");
    revalidatePath(`/admin/projects/${projectId}`);
    return { success: true, split: resultSplit };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to save project split.";
    return { success: false, error: message };
  }
}

/**
 * Dual-approval action: records approval by Founder 'A' or Founder 'B'.
 * When both have approved, changes status to 'APPROVED' and adds reserve inflow to cash ledger.
 */
export async function approveSplit(
  splitId: string,
  founder: "A" | "B"
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(splitId).success) {
      return { success: false, error: "Invalid split ID." };
    }

    if (founder !== "A" && founder !== "B") {
      return { success: false, error: "Founder must be 'A' or 'B'." };
    }

    // Call stored procedure public.approve_money_split
    const { data: rpcData, error: rpcError } = await supabase.rpc("approve_money_split", {
      p_split_id: splitId,
      p_founder: founder,
    });

    if (rpcError) {
      // Direct database fallback if RPC is not registered
      const { data: split, error: fetchErr } = await supabase
        .from("money_splits")
        .select("*, projects(name)")
        .eq("id", splitId)
        .single();

      if (fetchErr || !split) {
        return { success: false, error: fetchErr?.message || "Split not found." };
      }

      const approvedA = founder === "A" ? true : Boolean(split.approved_by_a);
      const approvedB = founder === "B" ? true : Boolean(split.approved_by_b);
      const newStatus = approvedA && approvedB ? "APPROVED" : "PENDING_APPROVAL";

      const { data: updated, error: updateErr } = await supabase
        .from("money_splits")
        .update({
          approved_by_a: approvedA,
          approved_by_b: approvedB,
          status: newStatus,
          updated_at: new Date().toISOString(),
        } as unknown as Record<string, unknown>)
        .eq("id", splitId)
        .select()
        .single();

      if (updateErr) {
        return { success: false, error: updateErr.message };
      }

      // Automatically insert into public.cash_ledger if fully approved
      if (newStatus === "APPROVED" && Number(split.reserve_amount) > 0) {
        const projectRecord = split as unknown as { projects?: { name?: string } };
        const projectName = projectRecord.projects?.name || `Project ${split.project_id}`;
        await supabase.from("cash_ledger").insert({
          project_id: split.project_id,
          type: "INFLOW",
          category: "RESERVE_INFLOW",
          amount: split.reserve_amount,
          description: `5% Studio Reserve from ${projectName}`,
        } as unknown as Record<string, unknown>);
      }

      revalidatePath("/admin/finance");
      return { success: true, result: updated };
    }

    revalidatePath("/admin/finance");
    return { success: true, result: rpcData };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to approve split.";
    return { success: false, error: message };
  }
}

/**
 * Fetches the entire finance overview:
 * - Aggregated gross revenue
 * - Total studio reserves
 * - Pending founder approvals count
 * - List of project splits with joined project details
 * - Cash ledger transaction history
 * - List of projects available for splitting
 */
export async function getFinanceOverview(): Promise<{
  success: boolean;
  data?: FinanceOverviewData;
  error?: string;
}> {
  try {
    const { supabase } = await requireFounder();

    // 1. Fetch all money splits
    const { data: splitsData, error: splitsError } = await supabase
      .from("money_splits")
      .select("*")
      .order("created_at", { ascending: false });

    if (splitsError) {
      // Table might not exist yet or has error
      return {
        success: false,
        error: `Failed to load splits: ${splitsError.message}`,
      };
    }

    const splitsList = (splitsData || []) as MoneySplitRow[];

    // 2. Fetch project details for splits
    const projectIds = [...new Set(splitsList.map((s) => s.project_id).filter(Boolean))];
    let projectMap: Record<
      string,
      { id: string; name: string; slug: string; contract_value: number }
    > = {};

    if (projectIds.length > 0) {
      const { data: projectsData } = await supabase
        .from("projects")
        .select("id, name, slug, contract_value")
        .in("id", projectIds);

      if (projectsData) {
        projectMap = Object.fromEntries(projectsData.map((p) => [p.id, p]));
      }
    }

    // 3. Fetch recent cash ledger entries
    const { data: ledgerData } = await supabase
      .from("cash_ledger")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    const ledgerEntries = (ledgerData || []) as CashLedgerRow[];

    // 4. Fetch available projects for creating new splits
    const { data: allProjectsData } = await supabase
      .from("projects")
      .select("id, name, slug, contract_value, photography_type, status")
      .order("created_at", { ascending: false })
      .limit(100);

    const availableProjects = (allProjectsData || []).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      contract_value: Number(p.contract_value || 0),
      photography_type: p.photography_type,
      status: p.status,
    }));

    // Calculate aggregated metrics
    const totalGrossRevenue = splitsList.reduce(
      (sum, s) => sum + (Number(s.gross_revenue) || 0),
      0
    );

    // Total reserves from approved splits
    const totalReserves = splitsList
      .filter((s) => s.status === "APPROVED")
      .reduce((sum, s) => sum + (Number(s.reserve_amount) || 0), 0);

    // Pending approvals count: splits awaiting at least one founder approval
    const pendingApprovalsCount = splitsList.filter(
      (s) => s.status === "PENDING_APPROVAL" || (s.status === "DRAFT" && (!s.approved_by_a || !s.approved_by_b))
    ).length;

    const approvedSplitsCount = splitsList.filter((s) => s.status === "APPROVED").length;

    const populatedSplits = splitsList.map((s) => ({
      ...s,
      project: projectMap[s.project_id],
    }));

    return {
      success: true,
      data: {
        totalGrossRevenue,
        totalReserves,
        pendingApprovalsCount,
        approvedSplitsCount,
        splits: populatedSplits,
        ledgerEntries,
        availableProjects,
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load finance overview.";
    return { success: false, error: message };
  }
}

/**
 * Creates an entry in the cash ledger (inflow, outflow, or founder advance).
 */
export async function createLedgerEntry(input: {
  projectId?: string | null;
  type: CashLedgerType;
  category: CashLedgerCategory;
  amount: number;
  description: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!input.description || input.description.trim().length === 0) {
      return { success: false, error: "Description is required." };
    }

    if (isNaN(input.amount) || input.amount <= 0) {
      return { success: false, error: "Amount must be greater than zero." };
    }

    const { error } = await supabase.from("cash_ledger").insert({
      project_id: input.projectId || null,
      type: input.type,
      category: input.category,
      amount: input.amount,
      description: input.description.trim(),
    } as unknown as Record<string, unknown>);
    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/admin/finance");
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create ledger entry.";
    return { success: false, error: message };
  }
}
