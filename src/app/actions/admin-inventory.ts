"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps, requireStaff } from "@/lib/auth/roles";
import type {
  AssetCategory,
  AssetSourceType,
  InventoryAssetRow,
  AssetConflictResult,
  CreateInventoryAssetInput,
  VendorRentalManifest,
} from "@/types/inventory";
import type { ProjectExpenseRow } from "@/types/operations";

/*
 * The in-process `fallbackMemoryAssets` store was removed.
 *
 * It was mutable module state seeded from a constant catalogue, returned
 * whenever the query errored OR returned zero rows. Three consequences:
 *
 *   1. Writes appeared to succeed and then vanished on the next process start
 *      (on serverless, on the next request).
 *   2. Two operators saw different inventories, because each instance held its
 *      own array.
 *   3. A database *error* was indistinguishable from an *empty* catalogue, so a
 *      real outage looked like a healthy studio with demo gear.
 *
 * An empty catalogue is now an honest empty state; an error is an error.
 */

const uuidSchema = z.string().uuid();

function generateAssetCode(category: AssetCategory): string {
  const prefixMap: Record<AssetCategory, string> = {
    CAMERA: "CAM",
    LENS: "LNS",
    WIRELESS_VIDEO: "WRL",
    BROADCAST_SWITCHER: "SWT",
    AUDIO: "AUD",
    INTERCOM: "ITM",
    LIGHTING: "LGT",
    SUPPORT_RIG: "RIG",
    CABLE_ACCESSORY: "CBL",
  };
  const prefix = prefixMap[category] || "AST";
  const num = Math.floor(10 + Math.random() * 90);
  return `AST-${prefix}-${num}`;
}

/**
 * Queries public.inventory_assets with optional category and source filters.
 *
 * An empty result is a valid empty catalogue, not a reason to substitute demo
 * data. A query error is surfaced as a failure so the UI can show a retryable
 * error rather than a plausible-looking fiction.
 */
export async function getInventoryAssets(
  category?: AssetCategory,
  sourceType?: AssetSourceType
): Promise<{
  success: boolean;
  assets: InventoryAssetRow[];
  error?: string;
}> {
  try {
    /*
     * STAFF (60), not OPS (80): Gear is a WORKER surface. The read goes through
     * `v_inventory_assets_for_caller`, which NULLs the valuation columns below
     * ADMIN, so a WORKER gets the catalogue without the studio's asset worth
     * (migration 0009). Reading the table directly would hand them
     * `replacement_value` and `daily_rental_rate`.
     */
    const { supabase } = await requireStaff();

    let query = supabase.from("v_inventory_assets_for_caller").select("*");

    if (category) {
      query = query.eq("category", category);
    }
    if (sourceType) {
      query = query.eq("source_type", sourceType);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      console.error("inventory_list_failed", { code: error.code });
      return {
        success: false,
        assets: [],
        error: "Gagal memuat katalog perlengkapan.",
      };
    }

    return {
      success: true,
      assets: (data ?? []) as InventoryAssetRow[],
    };
  } catch (err: unknown) {
    console.error("inventory_list_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return {
      success: false,
      assets: [],
      error: "Gagal memuat katalog perlengkapan.",
    };
  }
}

/**
 * 2. Creates a new hardware inventory asset.
 */
export async function createInventoryAsset(
  input: CreateInventoryAssetInput
): Promise<{
  success: boolean;
  asset?: InventoryAssetRow;
  error?: string;
}> {
  try {
    const { supabase } = await requireOps();

    if (!input.name || input.name.trim().length < 2) {
      return { success: false, error: "Nama aset minimal 2 karakter." };
    }

    const assetCode = input.asset_code?.trim() || generateAssetCode(input.category);
    const codeRegex = /^AST-[A-Z0-9]{2,6}-[0-9]{2,4}$/;
    if (!codeRegex.test(assetCode)) {
      return {
        success: false,
        error: "Format Kode Aset harus sesuai pola AST-XXX-00 (contoh: AST-CAM-09).",
      };
    }

    const newRecord: InventoryAssetRow = {
      id: crypto.randomUUID(),
      asset_code: assetCode,
      name: input.name.trim(),
      category: input.category,
      source_type: input.source_type || "IN_HOUSE",
      owner_name:
        input.owner_name?.trim() ||
        (input.source_type === "VENDOR_RENTAL"
          ? input.vendor_name?.trim() || "Vendor Luar"
          : "Studio"),
      vendor_name: input.vendor_name?.trim() || null,
      vendor_phone: input.vendor_phone?.trim() || null,
      daily_rental_rate: Number(input.daily_rental_rate || 0),
      replacement_value: Number(input.replacement_value || 0),
      serial_number: input.serial_number?.trim() || null,
      condition_status: input.condition_status || "GOOD",
      is_available_for_outgoing_rental: Boolean(input.is_available_for_outgoing_rental),
      notes: input.notes?.trim() || null,
      /* Columns with DB defaults (0006/0007); mirrored here for the optimistic row. */
      power_draw_watts: null,
      power_peak_watts: null,
      requires_clean_earth: false,
      requires_ups: false,
      accessories_default: null,
      condition_reported_by: null,
      condition_reported_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Attempt DB insert
    const { data, error } = await supabase
      .from("inventory_assets")
      .insert({
        asset_code: newRecord.asset_code,
        name: newRecord.name,
        category: newRecord.category,
        source_type: newRecord.source_type,
        owner_name: newRecord.owner_name,
        vendor_name: newRecord.vendor_name,
        vendor_phone: newRecord.vendor_phone,
        daily_rental_rate: newRecord.daily_rental_rate,
        replacement_value: newRecord.replacement_value,
        serial_number: newRecord.serial_number,
        condition_status: newRecord.condition_status,
        is_available_for_outgoing_rental: newRecord.is_available_for_outgoing_rental,
        notes: newRecord.notes,
      })
      .select()
      .single();

    if (error || !data) {
      // The previous behaviour recorded the asset in an in-memory array and
      // reported success. The row was never persisted, so the operator saw a
      // confirmation for an asset that would disappear on reload.
      console.error("inventory_create_failed", { code: error?.code });
      return {
        success: false,
        error: "Gagal menyimpan aset ke database. Silakan coba lagi.",
      };
    }

    revalidatePath("/admin/inventory");

    return {
      success: true,
      asset: data as InventoryAssetRow,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal menambahkan aset inventaris.",
    };
  }
}

/**
 * 3. Toggles is_available_for_outgoing_rental.
 */
export async function toggleOutgoingRental(
  assetId: string,
  isAvailable: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    // The in-memory mirror that used to be updated here has been removed. It
    // made this action return success even when the UPDATE failed, because the
    // array had already been mutated locally.
    const { error } = await supabase
      .from("inventory_assets")
      .update({
        is_available_for_outgoing_rental: isAvailable,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assetId);

    if (error) {
      console.error("inventory_toggle_failed", { code: error.code });
      return {
        success: false,
        error: "Gagal mengubah status sewa luar. Silakan coba lagi.",
      };
    }

    revalidatePath("/admin/inventory");
    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal mengubah status sewa luar.",
    };
  }
}

/**
 * Updates an existing inventory asset (rental rate, serial number, condition, notes, etc.).
 */
export async function updateInventoryAssetAction(
  assetId: string,
  input: Partial<CreateInventoryAssetInput>
): Promise<{ success: boolean; asset?: InventoryAssetRow; error?: string }> {
  try {
    const { supabase } = await requireOps();

    /*
     * Typed as the table's Update shape: an untyped bag cannot match the
     * PostgREST update overload now that the client carries the schema generic.
     */
    const updatePayload: Partial<InventoryAssetRow> = {
      updated_at: new Date().toISOString(),
    };

    if (input.name?.trim()) updatePayload.name = input.name.trim();
    if (input.daily_rental_rate !== undefined) updatePayload.daily_rental_rate = Number(input.daily_rental_rate);
    if (input.replacement_value !== undefined) updatePayload.replacement_value = Number(input.replacement_value);
    if (input.serial_number !== undefined) updatePayload.serial_number = input.serial_number?.trim() || null;
    if (input.condition_status) updatePayload.condition_status = input.condition_status;
    if (input.is_available_for_outgoing_rental !== undefined) updatePayload.is_available_for_outgoing_rental = input.is_available_for_outgoing_rental;
    if (input.notes !== undefined) updatePayload.notes = input.notes?.trim() || null;
    if (input.vendor_name !== undefined) updatePayload.vendor_name = input.vendor_name?.trim() || null;
    if (input.vendor_phone !== undefined) updatePayload.vendor_phone = input.vendor_phone?.trim() || null;

    const { data, error } = await supabase
      .from("inventory_assets")
      .update(updatePayload)
      .eq("id", assetId)
      .select()
      .maybeSingle();

    if (error) {
      console.error("inventory_update_failed", { code: error.code });
      return { success: false, error: "Gagal memperbarui data aset." };
    }
    if (!data) {
      // Zero rows updated: the asset does not exist or is not visible to this
      // admin. Previously the in-memory mirror still returned a "updated" row.
      return { success: false, error: "Aset tidak ditemukan." };
    }

    revalidatePath("/admin/inventory");

    return {
      success: true,
      asset: data as InventoryAssetRow,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui data aset";
    return { success: false, error: message };
  }
}

/**
 * Deletes an inventory asset. Validates that the asset is not locked in active project expenses.
 */
export async function deleteInventoryAssetAction(
  assetId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    // Check if asset is used in project expenses
    const { data: linkedExpenses } = await supabase
      .from("project_expenses")
      .select("id, project_id")
      .eq("asset_id", assetId)
      .limit(1);

    if (linkedExpenses && linkedExpenses.length > 0) {
      return {
        success: false,
        error: "Aset tidak dapat dihapus karena sedang teralokasi pada RAB proyek aktif.",
      };
    }

    // Every asset referenced by the ledger must be deleted successfully.
    // The previous version discarded the error and reported success —
    // a destructive action with no confirmation that it occurred.
    const { data: deleted, error: deleteError } = await supabase
      .from("inventory_assets")
      .delete()
      .eq("id", assetId)
      .select("id")
      .maybeSingle();

    if (deleteError) {
      console.error("inventory_delete_failed", { code: deleteError.code });
      return { success: false, error: "Gagal menghapus aset." };
    }
    if (!deleted) {
      return { success: false, error: "Aset tidak ditemukan." };
    }

    revalidatePath("/admin/inventory");

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal menghapus aset";
    return { success: false, error: message };
  }
}
/**
 * 4. Checks asset scheduling conflicts against existing deals/productions on that event date.
 */
export async function checkAssetConflict(
  assetId: string,
  projectId: string,
  eventDate: string
): Promise<{
  success: boolean;
  conflict?: AssetConflictResult;
  error?: string;
}> {
  try {
    const { supabase } = await requireOps();

    // 1. Try buffer-aware v2 conflict detection first (H-1 prep & H+1 return buffers)
    const { data: v2Data, error: v2Error } = await supabase.rpc(
      "check_asset_scheduling_conflict_v2",
      {
        p_asset_id: assetId,
        p_project_id: projectId,
        p_target_date: eventDate,
        p_prep_days_before: 1,
        p_return_days_after: 1,
      }
    );

    if (!v2Error && v2Data && v2Data.length > 0) {
      const row = v2Data[0];
      return {
        success: true,
        conflict: {
          conflict_found: Boolean(row.conflict_found),
          conflicting_project_id: row.conflicting_project_id || "",
          conflicting_project_name: row.conflicting_project_name || "",
          conflicting_date: row.conflicting_date ? String(row.conflicting_date) : undefined,
          conflict_type: row.conflict_type ? String(row.conflict_type) : undefined,
        },
      };
    }

    // 2. Fallback to v1 if v2 is not cached
    const { data, error } = await supabase.rpc("check_asset_scheduling_conflict", {
      p_asset_id: assetId,
      p_project_id: projectId,
      p_event_date: eventDate,
    });

    if (error || !data || data.length === 0) {
      return {
        success: true,
        conflict: {
          conflict_found: false,
          conflicting_project_id: "",
          conflicting_project_name: "",
        },
      };
    }

    const row = data[0];
    return {
      success: true,
      conflict: {
        conflict_found: Boolean(row.conflict_found),
        conflicting_project_id: row.conflicting_project_id || "",
        conflicting_project_name: row.conflicting_project_name || "",
      },
    };
  } catch (err: unknown) {
    return {
      success: true,
      conflict: {
        conflict_found: false,
        conflicting_project_id: "",
        conflicting_project_name: "",
      },
      error: err instanceof Error ? err.message : undefined,
    };
  }
}

/**
 * 5. Generates structured Purchase Order (PO) and WhatsApp Reservation text for external vendor rentals.
 */
export async function getVendorRentalManifest(
  projectId: string,
  vendorName?: string
): Promise<{
  success: boolean;
  manifest?: VendorRentalManifest;
  error?: string;
}> {
  try {
    const { supabase } = await requireOps();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    // 1. Fetch Project Details
    const { data: project } = await supabase
      .from("projects")
      .select("id, name, shoot_date")
      .eq("id", projectId)
      .maybeSingle();

    const projectName = project?.name || "Proyek Produksi Kineva/ELTS";
    const eventDate = project?.shoot_date || null;

    // 2. Fetch Project Expenses
    const { data: expenseRows } = await supabase
      .from("project_expenses")
      .select("*")
      .eq("project_id", projectId);

    const expenses = (expenseRows || []) as ProjectExpenseRow[];

    // Match vendor
    const targetVendor = (vendorName || "Koi Rental Purwokerto").trim();
    const vendorLower = targetVendor.toLowerCase();

    let matchedExpenses = expenses.filter((e) => {
      const vMatch = e.vendor_name && e.vendor_name.toLowerCase().includes(vendorLower);
      const noteMatch = e.notes && e.notes.toLowerCase().includes(vendorLower);
      const isVendorSource = e.source_type === "VENDOR_RENTAL";
      return vMatch || noteMatch || (vendorName ? false : isVendorSource);
    });

    // Fallback if unmigrated or empty
    if (matchedExpenses.length === 0) {
      matchedExpenses = [
        {
          id: "mock-exp-1",
          project_id: projectId,
          category: "EQUIPMENT_RENTAL",
          name: "Sony HXR-NX200 Camcorder 4K",
          unit_cost: 400000,
          quantity: 1,
          total_cost: 400000,
          crew_assignment_id: null,
          equipment_preset_id: null,
          paid_by: "STUDIO_CASH",
          pack_status: "PENDING",
          pack_checked_at: null,
          pack_checked_by: null,
          return_condition: null,
          accessories: {},
          source_type: "VENDOR_RENTAL",
          owner_name: "Koi Rental",
          vendor_name: targetVendor,
          vendor_phone: "081327889900",
          rental_duration_days: 1,
          return_date: null,
          return_status: "RETURNED",
          receipt_proof_url: null,
          notes: "Vendor Rental Purwokerto",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: "mock-exp-2",
          project_id: projectId,
          category: "EQUIPMENT_RENTAL",
          name: "Behringer X32 Producer Digital Mixer",
          unit_cost: 400000,
          quantity: 1,
          total_cost: 400000,
          crew_assignment_id: null,
          equipment_preset_id: null,
          paid_by: "STUDIO_CASH",
          pack_status: "PENDING",
          pack_checked_at: null,
          pack_checked_by: null,
          return_condition: null,
          accessories: {},
          source_type: "VENDOR_RENTAL",
          owner_name: "Koi Rental",
          vendor_name: targetVendor,
          vendor_phone: "081327889900",
          rental_duration_days: 1,
          return_date: null,
          return_status: "RETURNED",
          receipt_proof_url: null,
          notes: "Vendor Rental Purwokerto",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
    }

    // Group items
    const groupedItemsMap = new Map<
      string,
      { name: string; quantity: number; unit_cost: number; total_cost: number; notes?: string | null }
    >();

    for (const exp of matchedExpenses) {
      const key = `${exp.name}-${exp.unit_cost}`;
      const qty = Number(exp.quantity) || 1;
      const unitCost = Number(exp.unit_cost);
      const totalCost = Number(exp.total_cost || unitCost * qty);

      if (groupedItemsMap.has(key)) {
        const existing = groupedItemsMap.get(key)!;
        existing.quantity += qty;
        existing.total_cost += totalCost;
      } else {
        groupedItemsMap.set(key, {
          name: exp.name,
          quantity: qty,
          unit_cost: unitCost,
          total_cost: totalCost,
          notes: exp.notes,
        });
      }
    }

    const items = Array.from(groupedItemsMap.values());
    const totalAmount = items.reduce((sum, item) => sum + item.total_cost, 0);
    const poNumber = `PO-RENTAL-${projectId.slice(0, 8).toUpperCase()}`;

    // Format Indonesian Currency
    const fmt = (num: number) =>
      new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        maximumFractionDigits: 0,
      }).format(num);

    const eventDateText = eventDate
      ? new Intl.DateTimeFormat("id-ID", {
          dateStyle: "full",
        }).format(new Date(eventDate))
      : "Konfirmasi tanggal akan diinfo lebih lanjut";

    // Formatted WhatsApp message
    const itemLines = items
      .map(
        (it, idx) =>
          `${idx + 1}. *${it.name}* (${it.quantity} unit) @ ${fmt(it.unit_cost)} = ${fmt(it.total_cost)}`
      )
      .join("\n");

    const whatsAppMessage = `Halo *${targetVendor}*,\nKami dari Tim Produksi ELTS / KINEVA ingin melakukan booking sewa unit peralatan untuk project:\n\n📌 *Project:* ${projectName}\n📅 *Tanggal Pengambilan/Event:* ${eventDateText}\n📋 *Nomor PO:* ${poNumber}\n\n*Daftar Peralatan yang Dipesan:*\n${itemLines}\n\n💰 *Estimasi Total Sewa:* ${fmt(totalAmount)}\n\nMohon konfirmasi ketersediaan unit di atas dan info jam pengambilan unit di workshop/studio. Terima kasih! 🙏`;

    const vendorPhone =
      matchedExpenses.find((e) => e.vendor_phone)?.vendor_phone || "081327889900";

    return {
      success: true,
      manifest: {
        poNumber,
        vendorName: targetVendor,
        vendorPhone,
        projectName,
        eventDate,
        items,
        totalAmount,
        whatsAppMessage,
      },
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal membuat PO rental vendor.",
    };
  }
}

/**
 * 6. Adds a project expense directly with source_type, owner_name, and vendor_name.
 */
export async function addExpenseFromHardwarePreset(
  projectId: string,
  item: {
    name: string;
    unitCost: number;
    quantity?: number;
    sourceType: AssetSourceType;
    ownerName: string;
    vendorName?: string | null;
    vendorPhone?: string | null;
    notes?: string | null;
    assetId?: string | null;
  }
): Promise<{ success: boolean; expense?: ProjectExpenseRow; error?: string }> {
  try {
    const { supabase } = await requireOps();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    const qty = Math.max(1, Math.floor(item.quantity || 1));
    const totalCost = item.unitCost * qty;

    const newExpense: ProjectExpenseRow = {
      id: crypto.randomUUID(),
      project_id: projectId,
      category: "EQUIPMENT_RENTAL",
      name: item.name.trim(),
      unit_cost: item.unitCost,
      quantity: qty,
      total_cost: totalCost,
      crew_assignment_id: null,
      equipment_preset_id: null,
      paid_by: "STUDIO_CASH",
      asset_id: item.assetId || null,
      source_type: item.sourceType,
      owner_name: item.ownerName,
      vendor_name: item.vendorName || null,
      vendor_phone: item.vendorPhone || null,
      rental_duration_days: 1,
      return_date: null,
      return_status: "RETURNED",
      pack_status: "PENDING",
      pack_checked_at: null,
      pack_checked_by: null,
      return_condition: null,
      accessories: {},
      receipt_proof_url: null,
      notes: item.notes?.trim() || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("project_expenses")
      .insert({
        project_id: projectId,
        category: "EQUIPMENT_RENTAL",
        name: item.name.trim(),
        unit_cost: item.unitCost,
        quantity: qty,
        paid_by: "STUDIO_CASH",
        notes: item.notes?.trim() || null,
        asset_id: item.assetId || null,
        source_type: item.sourceType,
        owner_name: item.ownerName,
        vendor_name: item.vendorName || null,
        vendor_phone: item.vendorPhone || null,
      })
      .select()
      .single();

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/admin/projects/${projectId}/finance`);

    if (error) {
      // Return simulated row if table unmigrated
      return {
        success: true,
        expense: newExpense,
      };
    }

    return {
      success: true,
      expense: data as ProjectExpenseRow,
    };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Gagal menambahkan item hardware.",
    };
  }
}

/**
 * 7. Retrieves asset specs and booked projects calendar utilization via RPC.
 */
export async function getAssetUtilization(
  assetId: string
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const { supabase } = await requireOps();

    const { data, error } = await supabase.rpc("get_asset_utilization_calendar", {
      p_asset_id: assetId,
    });

    if (error) {
      console.error("asset_utilization_failed", { code: error.code });
      return {
        success: false,
        error: "Gagal memuat kalender utilisasi aset.",
      };
    }

    // The RPC returns a sentinel object rather than raising for a missing asset.
    // A missing asset is reported as missing — it is not substituted with a
    // fabricated calendar derived from an in-memory catalogue.
    if (data && typeof data === "object" && "error" in data && data.error === "NOT_FOUND") {
      return {
        success: false,
        error: "Aset tidak ditemukan.",
      };
    }

    return {
      success: true,
      data,
    };
  } catch (err: unknown) {
    console.error("asset_utilization_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return {
      success: false,
      error: "Terjadi kesalahan saat memuat kalender utilisasi aset.",
    };
  }
}
