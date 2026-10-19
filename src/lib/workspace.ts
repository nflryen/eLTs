import "server-only";
import { createServiceSupabase } from "@/lib/supabase/service";
import { requireStaff } from "@/lib/auth/roles";
import type { SectorId } from "@/lib/sector-lens";

export {
  WORKSPACE_MODULE_LABEL,
  WORKSPACE_MODULE_GROUPS,
  WORKSPACE_MODULES,
  type WorkspaceModule,
} from "@/lib/workspace-contract";

/**
 * Workspace data loader for the Project Console.
 *
 * ONE round trip pair per open. The eight modules share a single payload so
 * switching modules never re-fetches — which is what made the old `?tab=`
 * implementation feel sluggish (every tap triggered an RSC refetch).
 */

export type CrewAssignment = {
  id: string;
  role_title: string;
  acceptance_status: string;
  fee_agreed: number;
  payment_status: string;
  accepted_at: string | null;
  declined_reason: string | null;
  check_in_at: string | null;
  call_time: string | null;
  roll_time: string | null;
  crew_member_id: string;
  crew_name: string;
  crew_phone: string | null;
  crew_type: string | null;
  standard_day_rate: number | null;
  /** Denormalised for the WhatsApp invite template. */
  project_name?: string;
};

export type GearLine = {
  id: string;
  name: string;
  category: string;
  source_type: string;
  owner_name: string | null;
  vendor_name: string | null;
  vendor_phone: string | null;
  unit_cost: number;
  quantity: number;
  total_cost: number;
  pack_status: string;
  return_status: string;
  return_date: string | null;
  rental_duration_days: number;
  accessories: Record<string, unknown>;
  asset_id: string | null;
  asset_code: string | null;
  serial_number: string | null;
};

export type Receipt = {
  id: string;
  receipt_number: string;
  amount: number;
  payment_method: string;
  bank_name: string | null;
  applied_to: string;
  received_at: string;
  verified: boolean;
  notes: string | null;
};

export type InvoicePosition = {
  invoice_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  contract_value: number;
  minimum_dp_pct: number;
  minimum_dp_required: number;
  paid_amount: number;
  unverified_amount: number;
  balance_due: number;
  overpayment_amount: number;
  derived_status: string;
  dp_floor_satisfied: boolean;
  line_items: Array<{ description: string; quantity: number; unit_price: number; subtotal: number }>;
  receipts: Receipt[];
};

export type WorkspacePayload = {
  project: {
    id: string;
    name: string;
    slug: string;
    status: string;
    service_pillar: string;
    photography_type: string;
    shoot_date: string | null;
    rehearsal_date: string | null;
    /** Null when no price has been agreed. Never a placeholder figure. */
    contract_value: number | null;
    /** Null when no DP has been recorded. Never derived from the contract. */
    dp_amount: number | null;
    is_dp_paid: boolean;
    is_fully_paid: boolean;
    gallery_code: string;
    gallery_pin_hash: string;
    selection_locked_at: string | null;
    selection_quota_min: number;
    selection_quota_max: number;
    sector_specs: Record<string, unknown>;
  };
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  crew: CrewAssignment[];
  availableCrew: Array<{
    id: string;
    full_name: string;
    crew_code: string;
    phone: string;
    member_type: string;
    primary_skills: string[];
    standard_day_rate: number;
  }>;
  venue: { name: string; address: string; mapsUrl: string | null };
  gear: GearLine[];
  inventoryAssets: Array<{
    id: string;
    asset_code: string;
    name: string;
    category: string;
    source_type: string;
    owner_name: string;
    vendor_name: string | null;
    daily_rental_rate: number;
    is_available_for_outgoing_rental: boolean;
  }>;
  invoice: InvoicePosition | null;
  mediaCount: number;
  favoriteCount: number;
  editorTask: {
    id: string;
    status: string;
    deliverable_count: number;
    created_at: string;
    notes: string | null;
  } | null;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A nullable numeric read for money fields.
 *
 * `num()` turns an unset column into 0, which is indistinguishable from a
 * genuine zero. For contract value that difference decides whether a money
 * split may be computed at all, so unset must stay `null`.
 *
 * A real 0 stored in the database is still 0 — only absent/unset/non-numeric
 * becomes null.
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadWorkspace(projectId: string): Promise<WorkspacePayload | null> {
  await requireStaff();
  const supabase = createServiceSupabase();

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error || !project) return null;

  const [
    { data: customer },
    { data: crewRows },
    { data: allCrew },
    { data: gearRows },
    { data: assets },
    { data: invoices },
    { data: task },
    { count: mediaCount },
    { count: favCount },
  ] = await Promise.all([
    project.customer_id
      ? supabase.from("customers").select("id, name, email, phone").eq("id", project.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("project_crew_assignments")
      .select(
        "id, role_title, acceptance_status, fee_agreed, payment_status, accepted_at, declined_reason, check_in_at, call_time, roll_time, venue_name, venue_address, venue_maps_url, crew_member_id, crew_members(full_name, phone, member_type, standard_day_rate)",
      )
      .eq("project_id", projectId),
    supabase
      .from("crew_members")
      .select("id, full_name, crew_code, phone, member_type, primary_skills, standard_day_rate")
      .eq("is_active", true)
      .order("member_type", { ascending: true })
      .order("full_name", { ascending: true }),
    supabase
      .from("project_expenses")
      .select(
        "id, name, category, source_type, owner_name, vendor_name, vendor_phone, unit_cost, quantity, total_cost, pack_status, return_status, return_date, rental_duration_days, accessories, asset_id",
      )
      .eq("project_id", projectId)
      .order("source_type", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("inventory_assets")
      .select("id, asset_code, name, category, source_type, owner_name, vendor_name, daily_rental_rate, is_available_for_outgoing_rental")
      .order("asset_code", { ascending: true }),
    supabase
      .from("project_invoices")
      .select("id, invoice_number, issue_date, due_date, line_items, is_cancelled")
      .eq("project_id", projectId)
      .eq("is_cancelled", false)
      .order("issue_date", { ascending: false })
      .limit(1),
    supabase
      .from("editor_tasks")
      .select("id, status, deliverable_count, created_at, notes")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("media").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("favorites").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);

  // Asset code / serial lookup for gear lines
  const assetById = new Map((assets ?? []).map((a) => [a.id, a]));

  const crew: CrewAssignment[] = (crewRows ?? []).map((r) => {
    const member = (r as unknown as { crew_members: Record<string, unknown> | null }).crew_members;
    return {
      id: r.id as string,
      role_title: r.role_title as string,
      acceptance_status: r.acceptance_status as string,
      fee_agreed: num(r.fee_agreed),
      payment_status: r.payment_status as string,
      accepted_at: r.accepted_at as string | null,
      declined_reason: r.declined_reason as string | null,
      check_in_at: r.check_in_at as string | null,
      call_time: r.call_time as string | null,
      roll_time: r.roll_time as string | null,
      crew_member_id: r.crew_member_id as string,
      crew_name: (member?.full_name as string) ?? "Kru",
      crew_phone: (member?.phone as string) ?? null,
      crew_type: (member?.member_type as string) ?? null,
      standard_day_rate: member?.standard_day_rate != null ? num(member.standard_day_rate) : null,
    };
  });

  const gear: GearLine[] = (gearRows ?? []).map((g) => {
    const asset = g.asset_id ? assetById.get(g.asset_id as string) : null;
    return {
      id: g.id as string,
      name: g.name as string,
      category: g.category as string,
      source_type: g.source_type as string,
      owner_name: g.owner_name as string | null,
      vendor_name: g.vendor_name as string | null,
      vendor_phone: g.vendor_phone as string | null,
      unit_cost: num(g.unit_cost),
      quantity: num(g.quantity),
      total_cost: num(g.total_cost),
      pack_status: g.pack_status as string,
      return_status: g.return_status as string,
      return_date: g.return_date as string | null,
      rental_duration_days: num(g.rental_duration_days),
      accessories: (g.accessories as Record<string, unknown>) ?? {},
      asset_id: g.asset_id as string | null,
      asset_code: (asset?.asset_code as string) ?? null,
      serial_number: null,
    };
  });

  // ── Invoice + receipts via the derived view (single source of truth) ─────
  let invoice: InvoicePosition | null = null;
  const inv = invoices?.[0];
  if (inv) {
    const [{ data: position }, { data: receipts }] = await Promise.all([
      supabase.from("v_invoice_financial_position").select("*").eq("invoice_id", inv.id).maybeSingle(),
      supabase
        .from("invoice_payment_receipts")
        .select("id, receipt_number, amount, payment_method, bank_name, applied_to, received_at, verified_at, notes")
        .eq("invoice_id", inv.id)
        .order("received_at", { ascending: false }),
    ]);

    invoice = {
      invoice_id: inv.id as string,
      invoice_number: inv.invoice_number as string,
      issue_date: inv.issue_date as string,
      due_date: inv.due_date as string,
      contract_value: num(position?.contract_value),
      minimum_dp_pct: num(position?.minimum_dp_pct),
      minimum_dp_required: num(position?.minimum_dp_required),
      paid_amount: num(position?.paid_amount),
      unverified_amount: num(position?.unverified_amount),
      balance_due: num(position?.balance_due),
      overpayment_amount: num(position?.overpayment_amount),
      derived_status: (position?.derived_status as string) ?? "UNPAID",
      dp_floor_satisfied: Boolean(position?.dp_floor_satisfied),
      line_items: (inv.line_items as InvoicePosition["line_items"]) ?? [],
      receipts: (receipts ?? []).map((r) => ({
        id: r.id as string,
        receipt_number: r.receipt_number as string,
        amount: num(r.amount),
        payment_method: r.payment_method as string,
        bank_name: r.bank_name as string | null,
        applied_to: r.applied_to as string,
        received_at: r.received_at as string,
        verified: r.verified_at !== null,
        notes: r.notes as string | null,
      })),
    };
  }

  // ── Venue resolution: prefer the crew assignment, fall back to sector_specs
  const specs = (project.sector_specs as Record<string, unknown>) ?? {};
  const firstAssignment = crewRows?.[0];
  const venue = {
    name:
      (project as unknown as { venue_name?: string }).venue_name ??
      (firstAssignment?.venue_name as string) ??
      (specs.venueName as string) ??
      "Lokasi belum ditentukan",
    address:
      (project as unknown as { venue_address?: string }).venue_address ??
      (firstAssignment?.venue_address as string) ??
      "",
    mapsUrl: (firstAssignment?.venue_maps_url as string) ?? null,
  };

  /*
   * FINANCIAL VALUES ARE NEVER INVENTED.
   *
   * This block previously guessed a contract value from the project NAME —
   * Rp25.000.000 for anything containing "KOMDIGI", Rp15.000.000 for "UNSOED" or
   * "Graduation" — and then derived a 50% DP from the guess. Those numbers
   * reached the RAB panel, which posts `grossRevenue: contract_value` into an
   * approvable money split. A project with no negotiated price could therefore
   * produce a persisted, founder-approved revenue split built from a string
   * match. The same guess also marked the DP as paid (`contractVal > 0 &&
   * isWisuda`), so an unpaid project could read as settled.
   *
   * Unset now stays unset. `null` propagates so the UI can say "belum diisi"
   * instead of showing a plausible, wrong figure.
   */
  const isKomdigi = Boolean((project.name as string)?.includes("KOMDIGI"));
  const isWisuda = Boolean((project.name as string)?.includes("UNSOED")) || Boolean((project.name as string)?.includes("Graduation"));
  const contractVal = numOrNull(project.contract_value);
  const dpAmount = numOrNull(project.dp_amount);

  return {
    project: {
      id: project.id as string,
      name: project.name as string,
      slug: project.slug as string,
      status: project.status as string,
      service_pillar: (project.service_pillar as string) || (isKomdigi ? "BROADCAST_LIVE_STREAMING" : isWisuda ? "EVENT_GRADUATION_PHOTO" : "EVENT_GRADUATION_PHOTO"),
      photography_type: project.photography_type as string,
      shoot_date: project.shoot_date as string | null,
      rehearsal_date: project.rehearsal_date as string | null,
      contract_value: contractVal,
      dp_amount: dpAmount,
      is_fully_paid: Boolean(project.is_fully_paid),
      // Payment state is a fact recorded in the database, never inferred from
      // the project name. The previous `|| (contractVal > 0 && isWisuda)` marked
      // every graduation project as having paid its DP.
      is_dp_paid: Boolean(project.is_dp_paid),
      gallery_code: project.gallery_code as string,
      gallery_pin_hash: project.gallery_pin_hash as string,
      selection_locked_at: project.selection_locked_at as string | null,
      selection_quota_min: num(project.selection_quota_min) || 15,
      selection_quota_max: num(project.selection_quota_max) || 20,
      sector_specs: specs,
    },
    customer: customer
      ? { id: customer.id as string, name: customer.name as string, email: customer.email as string | null, phone: customer.phone as string | null }
      : null,
    crew,
    availableCrew: (allCrew ?? []).map((c) => ({
      id: c.id as string,
      full_name: c.full_name as string,
      crew_code: c.crew_code as string,
      phone: c.phone as string,
      member_type: c.member_type as string,
      primary_skills: (c.primary_skills as string[]) ?? [],
      standard_day_rate: num(c.standard_day_rate),
    })),
    venue,
    gear,
    inventoryAssets: (assets ?? []).map((a) => ({
      id: a.id as string,
      asset_code: a.asset_code as string,
      name: a.name as string,
      category: a.category as string,
      source_type: a.source_type as string,
      owner_name: a.owner_name as string,
      vendor_name: a.vendor_name as string | null,
      daily_rental_rate: num(a.daily_rental_rate),
      is_available_for_outgoing_rental: Boolean(a.is_available_for_outgoing_rental),
    })),
    invoice,
    mediaCount: mediaCount ?? 0,
    favoriteCount: favCount ?? 0,
    editorTask: task?.[0]
      ? {
          id: task[0].id as string,
          status: task[0].status as string,
          deliverable_count: num(task[0].deliverable_count),
          created_at: task[0].created_at as string,
          notes: task[0].notes as string | null,
        }
      : null,
  };
}

/** Maps a service pillar to the Sector Engine that renders it. */
export function sectorEngineFor(pillar: string): SectorId {
  if (pillar === "BROADCAST_LIVE_STREAMING") return "BROADCAST_LIVE_STREAMING";
  if (pillar === "COMMERCIAL_VIDEO") return "COMMERCIAL_VIDEO";
  return "EVENT_GRADUATION_PHOTO";
}
