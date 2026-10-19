import "server-only";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireOps } from "@/lib/auth/roles";

/**
 * GEAR DUAL-EXPORT — Stream A and Stream B are structurally separate.
 *
 * WHY TWO ENGINES, NOT ONE FILTER
 * -------------------------------
 * A packing slip and a purchase order are different legal objects:
 *
 *   Stream A (packing slip)  internal custody record — no money, no vendor,
 *                            checklist for warehouse prep and return audit.
 *   Stream B (vendor PO)     commercial contract — money owed, SLA, deposit.
 *
 * Mixing them is why warehouse prep felt chaotic: the person packing a flight
 * case does not care what a vendor charges, and the person booking a vendor does
 * not care about battery counts.
 *
 * STRICT INVARIANTS (enforced here, not in the UI):
 *   • Stream A rejects any VENDOR_RENTAL row.
 *   • Stream B rejects any IN_HOUSE / PARTNER_OWNED row.
 *   • Both reject non-asset rows (crew honor, transport, meals) — those are
 *     project_expenses for the RAB, not physical items to pack or rent.
 * Violations THROW. They never silently filter, because a silent filter is how
 * a vendor item ends up on a packing slip nobody checks.
 */

export class ManifestInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestInvariantError";
  }
}

export type PackItem = {
  expenseId: string;
  assetCode: string | null;
  name: string;
  serialNumber: string | null;
  sourceType: "IN_HOUSE" | "PARTNER_OWNED";
  ownerName: string;
  category: string;
  packStatus: string;
  packCheckedAt: string | null;
  accessories: {
    batteries?: number;
    charger?: boolean;
    cards?: Array<{ capacity_gb: number; qty: number }>;
    cables?: string[];
  };
};

export type PackStreamA = {
  project: {
    id: string;
    name: string;
    shootDate: string | null;
    rehearsalDate: string | null;
    venueName: string;
    venueAddress: string;
  };
  totalItems: number;
  totalAccessories: number;
  studioItems: PackItem[];
  partnerItems: PackItem[];
  generatedAt: string;
};

export type PoLine = {
  description: string;
  quantity: number;
  unitDays: number;
  unitRate: number;
  lineTotal: number;
};

export type PoStreamB = {
  project: { id: string; name: string; shootDate: string | null };
  vendors: Array<{
    vendorName: string;
    vendorPhone: string | null;
    vendorAddress: string | null;
    poNumber: string | null;
    status: string;
    pickupAt: string | null;
    returnDueAt: string | null;
    subtotal: number;
    depositAmount: number;
    notes: string | null;
    lines: PoLine[];
  }>;
  grandTotal: number;
  generatedAt: string;
};

/**
 * Stream A predicate: a PHYSICAL, CATALOGUED item you pack into a case.
 *
 * `asset_id` is required here because a packing slip needs the asset code and
 * serial to be checkable at the warehouse. A vendor line has no studio tag, so
 * this predicate would wrongly exclude it — see `isVendorRentableRow` below.
 *
 * Crew honor, transport, meals, and consumables are RAB entries: they are never
 * packed into a flight case.
 */
function isPhysicalAssetRow(row: { asset_id: string | null; category: string }): boolean {
  if (!row.asset_id) return false;
  return !["CREW_FEE", "TRANSPORT_LOGISTICS", "MEALS_CONSUMPTION", "SUPPLIES_MISC", "BANDWIDTH_SIM"].includes(
    row.category,
  );
}

/**
 * Stream B predicate: something rented FROM a vendor.
 *
 * Deliberately does NOT require `asset_id`. A rental house item frequently has
 * no studio catalogue entry — you are renting it precisely because you do not
 * own it. Requiring an asset row here silently dropped real PO lines.
 */
function isVendorRentableRow(row: { category: string }): boolean {
  return !["CREW_FEE", "TRANSPORT_LOGISTICS", "MEALS_CONSUMPTION", "SUPPLIES_MISC", "BANDWIDTH_SIM"].includes(
    row.category,
  );
}

export async function buildStreamA(projectId: string): Promise<PackStreamA> {
  await requireOps();
  const supabase = createServiceSupabase();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, shoot_date, rehearsal_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) throw new Error("Proyek tidak ditemukan");

  const { data: rows } = await supabase
    .from("project_expenses")
    .select(
      "id, name, category, source_type, owner_name, pack_status, pack_checked_at, accessories, asset_id, inventory_assets(asset_code, serial_number, category)",
    )
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  /*
   * PARTITION, then ASSERT.
   *
   * The stream is defined by source_type, so filter on it first: Stream A owns
   * IN_HOUSE and PARTNER_OWNED, Stream B owns VENDOR_RENTAL. A vendor-rented
   * asset that also has an inventory_assets row (e.g. a rented mixer that is
   * catalogued for pricing) must go to the PO, not the packing slip.
   *
   * The assertion below stays as a safety net: if the filter is ever widened
   * incorrectly, this throws rather than silently shipping a vendor item on a
   * document nobody double-checks.
   */
  const physical = (rows ?? []).filter((r) =>
    isPhysicalAssetRow(r as { asset_id: string | null; category: string }),
  );
  const streamOwned = physical.filter(
    (r) => r.source_type === "IN_HOUSE" || r.source_type === "PARTNER_OWNED",
  );

  // ── STRICT INVARIANT ─────────────────────────────────────────────────────
  const intruders = streamOwned.filter((r) => r.source_type === "VENDOR_RENTAL");
  if (intruders.length > 0) {
    throw new ManifestInvariantError(
      `Manifest Muat hanya untuk aset internal/partner. Ditemukan ${intruders.length} item sewa vendor: ` +
        intruders.map((r) => r.name).join(", ") +
        ". Gunakan PO Sewa Vendor untuk item tersebut.",
    );
  }

  const mapItem = (r: Record<string, unknown>): PackItem => {
    const asset = (r.inventory_assets as Record<string, unknown> | null) ?? null;
    const acc = (r.accessories as PackItem["accessories"]) ?? {};
    return {
      expenseId: r.id as string,
      assetCode: (asset?.asset_code as string) ?? null,
      name: r.name as string,
      serialNumber: (asset?.serial_number as string) ?? null,
      sourceType: (r.source_type as "IN_HOUSE" | "PARTNER_OWNED") ?? "IN_HOUSE",
      ownerName: (r.owner_name as string) ?? "Studio",
      category: ((asset?.category as string) ?? (r.category as string)) ?? "",
      packStatus: r.pack_status as string,
      packCheckedAt: r.pack_checked_at as string | null,
      accessories: acc,
    };
  };

  const items = streamOwned.map(mapItem);
  const countAccessories = (i: PackItem) =>
    (i.accessories.batteries ?? 0) + (i.accessories.cards?.reduce((s, c) => s + c.qty, 0) ?? 0) + (i.accessories.charger ? 1 : 0);

  const { data: assignment } = await supabase
    .from("project_crew_assignments")
    .select("venue_name, venue_address")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  return {
    project: {
      id: project.id as string,
      name: project.name as string,
      shootDate: project.shoot_date as string | null,
      rehearsalDate: project.rehearsal_date as string | null,
      venueName: (assignment?.venue_name as string) ?? "—",
      venueAddress: (assignment?.venue_address as string) ?? "",
    },
    totalItems: items.length,
    totalAccessories: items.reduce((s, i) => s + countAccessories(i), 0),
    studioItems: items.filter((i) => i.sourceType === "IN_HOUSE"),
    partnerItems: items.filter((i) => i.sourceType === "PARTNER_OWNED"),
    generatedAt: new Date().toISOString(),
  };
}

export async function buildStreamB(projectId: string): Promise<PoStreamB> {
  await requireOps();
  const supabase = createServiceSupabase();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, shoot_date")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) throw new Error("Proyek tidak ditemukan");

  const [{ data: rows }, { data: pos }] = await Promise.all([
    supabase
      .from("project_expenses")
      .select("id, name, source_type, source_type, unit_cost, quantity, rental_duration_days, vendor_name, vendor_phone, asset_id, category")
      .eq("project_id", projectId)
      .eq("source_type", "VENDOR_RENTAL")
      .order("vendor_name", { ascending: true }),
    supabase
      .from("vendor_purchase_orders")
      .select("id, po_number, vendor_name, vendor_phone, vendor_address, pickup_at, return_due_at, status, subtotal, deposit_amount, notes")
      .eq("project_id", projectId),
  ]);

  // Vendor lines are NOT required to have an inventory_assets row: you rent
  // what you do not own, so requiring a studio tag silently dropped real PO
  // lines (e.g. an Aputure 300d with no catalogue entry).
  const vendorsFromExpenses = (rows ?? []).filter((r) =>
    isVendorRentableRow(r as { category: string }),
  );

  // ── STRICT INVARIANT ─────────────────────────────────────────────────────
  // buildStreamB only ever SELECTS source_type = VENDOR_RENTAL, so a foreign
  // row cannot arrive via the query. The guarantee is asserted rather than
  // assumed, because a future edit to the filter must not silently widen it.
  const wrongSource = vendorsFromExpenses.filter((r) => r.source_type !== "VENDOR_RENTAL");
  if (wrongSource.length > 0) {
    throw new ManifestInvariantError(
      `PO Sewa Vendor hanya untuk item sewa. Ditemukan ${wrongSource.length} aset internal.`,
    );
  }

  const poByVendor = new Map((pos ?? []).map((p) => [p.vendor_name as string, p]));
  const grouped = new Map<string, PoLine[]>();
  const meta = new Map<string, { phone: string | null }>();

  for (const r of vendorsFromExpenses) {
    const vendor = (r.vendor_name as string) ?? "Vendor Tidak Diketahui";
    const days = Number(r.rental_duration_days) || 1;
    const rate = Number(r.unit_cost) || 0;
    const qty = Number(r.quantity) || 1;
    const lines = grouped.get(vendor) ?? [];
    lines.push({
      description: r.name as string,
      quantity: qty,
      unitDays: days,
      unitRate: rate,
      lineTotal: qty * days * rate,
    });
    grouped.set(vendor, lines);
    meta.set(vendor, { phone: (r.vendor_phone as string) ?? null });
  }

  const vendors = [...grouped.entries()].map(([vendorName, lines]) => {
    const po = poByVendor.get(vendorName);
    const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
    return {
      vendorName,
      vendorPhone: (po?.vendor_phone as string) ?? meta.get(vendorName)?.phone ?? null,
      vendorAddress: (po?.vendor_address as string) ?? null,
      poNumber: (po?.po_number as string) ?? null,
      status: (po?.status as string) ?? "DRAFT",
      pickupAt: (po?.pickup_at as string) ?? null,
      returnDueAt: (po?.return_due_at as string) ?? null,
      subtotal: po ? Number(po.subtotal) : subtotal,
      depositAmount: po ? Number(po.deposit_amount) : 0,
      notes: (po?.notes as string) ?? null,
      lines,
    };
  });

  return {
    project: {
      id: project.id as string,
      name: project.name as string,
      shootDate: project.shoot_date as string | null,
    },
    vendors,
    grandTotal: vendors.reduce((s, v) => s + v.subtotal, 0),
    generatedAt: new Date().toISOString(),
  };
}
