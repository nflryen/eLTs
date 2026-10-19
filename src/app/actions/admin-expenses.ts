"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireFounder } from "@/lib/auth/roles";
import { createOrUpdateProjectSplit } from "@/app/actions/admin-finance";
import type {
  ExpenseCategory,
  ExpensePaidBy,
  ProjectExpenseRow,
  EquipmentPresetRow,
  AddProjectExpenseInput,
  ProjectExpensesResult,
} from "@/types/operations";
import type { MoneySplitRow } from "@/types/database";

const uuidSchema = z.string().uuid();

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "CREW_FEE",
  "EQUIPMENT_RENTAL",
  "EQUIPMENT_DEPRECIATION",
  "TRANSPORT_LOGISTICS",
  "MEALS_CONSUMPTION",
  "BANDWIDTH_SIM",
  "SUPPLIES_MISC",
  "CLIENT_ADDON",
];

const EXPENSE_PAID_BY_OPTIONS: ExpensePaidBy[] = [
  "STUDIO_CASH",
  "FOUNDER_A_ADVANCE",
  "FOUNDER_B_ADVANCE",
  "CLIENT_BILLED",
];


/**
 * Fetches all expense items for a project, computes category totals and total direct costs.
 */
export async function getProjectExpenses(
  projectId: string
): Promise<ProjectExpensesResult> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(projectId).success) {
      return {
        success: false,
        expenses: [],
        categoryTotals: initializeCategoryTotals(),
        totalDirectCosts: 0,
        error: "Invalid project ID format.",
      };
    }

    const { data, error } = await supabase
      .from("project_expenses")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (error) {
      return {
        success: false,
        expenses: [],
        categoryTotals: initializeCategoryTotals(),
        totalDirectCosts: 0,
        error: error.message,
      };
    }

    const expenses = (data ?? []) as ProjectExpenseRow[];
    const categoryTotals = initializeCategoryTotals();
    let totalDirectCosts = 0;
    let totalCashOutflow = 0;
    let totalNonCashDepreciation = 0;

    for (const exp of expenses) {
      const cost = Number(exp.total_cost ?? exp.unit_cost * exp.quantity);
      if (exp.category in categoryTotals) {
        categoryTotals[exp.category as ExpenseCategory] += cost;
      }
      totalDirectCosts += cost;
      if (exp.is_cash_outflow === false || exp.category === "EQUIPMENT_DEPRECIATION") {
        totalNonCashDepreciation += cost;
      } else {
        totalCashOutflow += cost;
      }
    }

    return {
      success: true,
      expenses,
      categoryTotals,
      totalDirectCosts,
      totalCashOutflow,
      totalNonCashDepreciation,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch project expenses";
    return {
      success: false,
      expenses: [],
      categoryTotals: initializeCategoryTotals(),
      totalDirectCosts: 0,
      error: message,
    };
  }
}

/**
 * Inserts a new line item into public.project_expenses.
 * Note: total_cost is GENERATED ALWAYS by PostgreSQL, so it is omitted from the insert.
 */
export async function addProjectExpense(
  projectId: string,
  categoryOrInput: ExpenseCategory | AddProjectExpenseInput,
  nameParam?: string,
  unitCostParam?: number,
  quantityParam?: number,
  paidByParam?: ExpensePaidBy,
  notesParam?: string | null,
  equipmentPresetIdParam?: string | null
): Promise<{ success: boolean; expense?: ProjectExpenseRow; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid project ID." };
    }

    let category: ExpenseCategory;
    let name: string;
    let unitCost: number;
    let quantity: number = 1;
    let paidBy: ExpensePaidBy = "STUDIO_CASH";
    let notes: string | null = null;
    let equipmentPresetId: string | null = null;
    let receiptProofUrl: string | null = null;

    if (typeof categoryOrInput === "object" && categoryOrInput !== null) {
      category = categoryOrInput.category;
      name = categoryOrInput.name;
      unitCost = Number(categoryOrInput.unitCost);
      quantity = Number(categoryOrInput.quantity ?? 1);
      paidBy = categoryOrInput.paidBy ?? "STUDIO_CASH";
      notes = categoryOrInput.notes ?? null;
      equipmentPresetId = categoryOrInput.equipmentPresetId ?? null;
      receiptProofUrl = categoryOrInput.receiptProofUrl ?? null;
    } else {
      category = categoryOrInput;
      name = nameParam ?? "";
      unitCost = Number(unitCostParam ?? 0);
      quantity = Number(quantityParam ?? 1);
      paidBy = paidByParam ?? "STUDIO_CASH";
      notes = notesParam ?? null;
      equipmentPresetId = equipmentPresetIdParam ?? null;
    }

    if (!EXPENSE_CATEGORIES.includes(category)) {
      return { success: false, error: `Kategori tidak valid: ${category}` };
    }

    // TASK 3: Reject manual CREW_FEE entries to prevent double-counting
    if (category === "CREW_FEE") {
      return {
        success: false,
        error: "Biaya honor kru (CREW_FEE) tidak dapat ditambahkan secara manual. Gunakan alur penugasan kru resmi (Dispatch Kru) agar honor tersinkronisasi otomatis saat disetujui.",
      };
    }

    if (!name || name.trim().length < 2 || name.trim().length > 200) {
      return { success: false, error: "Nama item harus antara 2 dan 200 karakter." };
    }

    if (isNaN(unitCost) || unitCost < 0) {
      return { success: false, error: "Biaya satuan harus berupa angka non-negatif." };
    }

    if (isNaN(quantity) || quantity <= 0) {
      return { success: false, error: "Kuantitas harus lebih besar dari 0." };
    }

    if (!EXPENSE_PAID_BY_OPTIONS.includes(paidBy)) {
      return { success: false, error: "Metode pembayaran tidak valid." };
    }

    // TASK 2: Determine two-bucket cash outflow status
    const isCashOutflow =
      category === "EQUIPMENT_DEPRECIATION"
        ? false
        : true;

    const { data, error } = await supabase
      .from("project_expenses")
      .insert({
        project_id: projectId,
        category,
        name: name.trim(),
        unit_cost: unitCost,
        quantity,
        paid_by: paidBy,
        notes: notes ? notes.trim() : null,
        equipment_preset_id: equipmentPresetId || null,
        receipt_proof_url: receiptProofUrl || null,
        is_cash_outflow: isCashOutflow,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);

    return { success: true, expense: data as ProjectExpenseRow };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add project expense",
    };
  }
}

/**
 * Removes an expense item. Prevents deletion if tied to a crew assignment unless confirmed.
 */
export async function deleteProjectExpense(
  expenseId: string,
  projectId: string,
  confirmCrewSyncDelete?: boolean
): Promise<{ success: boolean; error?: string; isCrewLocked?: boolean }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(expenseId).success || !uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid ID format." };
    }

    // Inspect if item is tied to a crew assignment
    const { data: existing, error: fetchError } = await supabase
      .from("project_expenses")
      .select("id, crew_assignment_id, name")
      .eq("id", expenseId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (fetchError || !existing) {
      return { success: false, error: "Item pengeluaran tidak ditemukan." };
    }

    if (existing.crew_assignment_id && !confirmCrewSyncDelete) {
      return {
        success: false,
        isCrewLocked: true,
        error:
          "Item biaya ini disinkronkan otomatis dari Penugasan Kru. Hapus atau batalkan penugasan kru terkait di tab Kru untuk menghapus item ini.",
      };
    }

    const { error: deleteError } = await supabase
      .from("project_expenses")
      .delete()
      .eq("id", expenseId)
      .eq("project_id", projectId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to delete project expense",
    };
  }
}

/**
 * Updates an existing line item in public.project_expenses.
 */
export async function updateProjectExpenseAction(
  expenseId: string,
  projectId: string,
  data: {
    name?: string;
    unitCost?: number;
    quantity?: number;
    paidBy?: ExpensePaidBy;
    notes?: string | null;
    /** Check-in / check-out staging status for rented & borrowed gear. */
    returnStatus?: "PENDING" | "RETURNED" | "OVERDUE";
  }
): Promise<{ success: boolean; expense?: ProjectExpenseRow; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(expenseId).success) {
      return { success: false, error: "ID pengeluaran tidak valid." };
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (data.name?.trim()) updatePayload.name = data.name.trim();
    if (data.unitCost !== undefined) updatePayload.unit_cost = Number(data.unitCost);
    if (data.quantity !== undefined) updatePayload.quantity = Number(data.quantity);
    if (data.paidBy) updatePayload.paid_by = data.paidBy;
    if (data.notes !== undefined) updatePayload.notes = data.notes?.trim() || null;
    if (data.returnStatus !== undefined) updatePayload.return_status = data.returnStatus;

    const { data: updated, error } = await supabase
      .from("project_expenses")
      .update(updatePayload)
      .eq("id", expenseId)
      .eq("project_id", projectId)
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);

    return { success: true, expense: updated as ProjectExpenseRow };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui pengeluaran";
    return { success: false, error: message };
  }
}

/**
 * Returns the active equipment preset catalog.
 */
export async function getEquipmentPresets(): Promise<{
  success: boolean;
  presets: EquipmentPresetRow[];
  error?: string;
}> {
  try {
    const { supabase } = await requireFounder();

    const { data, error } = await supabase
      .from("equipment_presets")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      return { success: false, presets: [], error: error.message };
    }

    return {
      success: true,
      presets: (data ?? []) as EquipmentPresetRow[],
    };
  } catch (err: unknown) {
    return {
      success: false,
      presets: [],
      error: err instanceof Error ? err.message : "Failed to fetch equipment presets",
    };
  }
}

/**
 * Quick-inserts a line item using the preset's default rate.
 */
export async function addEquipmentFromPreset(
  projectId: string,
  presetId: string,
  quantity: number = 1
): Promise<{ success: boolean; expense?: ProjectExpenseRow; error?: string }> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(projectId).success || !uuidSchema.safeParse(presetId).success) {
      return { success: false, error: "ID proyek atau preset tidak valid." };
    }

    const { data: preset, error: presetError } = await supabase
      .from("equipment_presets")
      .select("*")
      .eq("id", presetId)
      .single();

    if (presetError || !preset) {
      return { success: false, error: "Preset perangkat keras tidak ditemukan." };
    }

    const qty = Math.max(1, Math.floor(quantity));
    const unitCost = Number(preset.default_rental_rate);

    const { data, error } = await supabase
      .from("project_expenses")
      .insert({
        project_id: projectId,
        category: "EQUIPMENT_RENTAL",
        name: preset.name,
        unit_cost: unitCost,
        quantity: qty,
        equipment_preset_id: preset.id,
        paid_by: "STUDIO_CASH",
        notes: `Preset: ${preset.name} (${preset.category})`,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);

    return { success: true, expense: data as ProjectExpenseRow };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to add equipment from preset",
    };
  }
}

/**
 * Computes total direct costs from public.project_expenses and updates money_splits.direct_costs
 * via createOrUpdateProjectSplit.
 */
export async function syncExpensesToWaterfallSplit(
  projectId: string
): Promise<{
  success: boolean;
  directCosts?: number;
  split?: MoneySplitRow;
  error?: string;
}> {
  try {
    const { supabase } = await requireFounder();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid project ID." };
    }

    // 1. Fetch Project details (contract value)
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, name, contract_value")
      .eq("id", projectId)
      .single();

    if (projectError || !project) {
      return { success: false, error: "Proyek tidak ditemukan." };
    }

    // 2. Fetch all expenses with cash outflow and source flags
    const { data: expenses, error: expensesError } = await supabase
      .from("project_expenses")
      .select("unit_cost, quantity, total_cost, is_cash_outflow, category, source_type, owner_name")
      .eq("project_id", projectId);

    if (expensesError) {
      return { success: false, error: expensesError.message };
    }

    let totalDirectCashCosts = 0;

    for (const exp of expenses ?? []) {
      /*
       * Only cash outflows enter the direct-cost total. Depreciation is an
       * accrual, not money leaving the account, so it is excluded here — the
       * `nonCashDepreciation` accumulator that used to sit in the other branch
       * was never read by any consumer.
       */
      const cost = Number(exp.total_cost ?? exp.unit_cost * exp.quantity);
      if (exp.is_cash_outflow !== false && exp.category !== "EQUIPMENT_DEPRECIATION") {
        totalDirectCashCosts += cost;
      }
    }
    // 3. Check for existing money_splits record to retain commission & closer settings
    const { data: existingSplit } = await supabase
      .from("money_splits")
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();

    const grossRevenue = existingSplit
      ? Number(existingSplit.gross_revenue)
      : Number(project.contract_value ?? 0);

    const commissionPct = existingSplit ? Number(existingSplit.commission_pct) : 0;
    const closerName = existingSplit ? existingSplit.closer_name : null;

    // 4. Update or create the project split
    // 4. Update or create the project split using CASH direct costs only
    const splitResult = await createOrUpdateProjectSplit({
      projectId,
      grossRevenue,
      directCosts: totalDirectCashCosts,
      commissionPct,
      closerName,
    });

    if (!splitResult.success) {
      return { success: false, error: splitResult.error };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);
    revalidatePath(`/admin/finance`);

    return {
      success: true,
      directCosts: totalDirectCashCosts,
      split: splitResult.split,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Gagal menyinkronkan pengeluaran ke Waterfall Split",
    };
  }
}

function initializeCategoryTotals(): Record<ExpenseCategory, number> {
  return {
    CREW_FEE: 0,
    EQUIPMENT_RENTAL: 0,
    EQUIPMENT_DEPRECIATION: 0,
    TRANSPORT_LOGISTICS: 0,
    MEALS_CONSUMPTION: 0,
    BANDWIDTH_SIM: 0,
    SUPPLIES_MISC: 0,
    CLIENT_ADDON: 0,
  };
}
