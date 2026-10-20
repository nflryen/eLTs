"use server";

import { requirePageOps, requirePageStaff } from "@/lib/auth/roles";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * Payroll & compensation data access.
 *
 * AUTHORIZATION MODEL
 * -------------------
 * Every function here gates on `requirePageOps()` (rank >= 80: ADMIN, FOUNDER,
 * SUPER_ADMIN). WORKER and FREELANCER never reach these — their telemetry comes
 * from `my_earnings_summary()` instead, which takes zero arguments and scopes
 * itself to `auth.uid()`.
 *
 * REDACTION IS DONE IN THE QUERY, NOT IN THE COMPONENT.
 * A dividend row must never be *fetched* by an ADMIN and then hidden in JSX —
 * hiding happens after the value is already serialised into the RSC payload.
 * `kind = 'DIVIDEND'` is filtered out of the SQL for rank < 100, so the row
 * does not exist client-side at all.
 */

export type PayrollLineItem = {
  id: string;
  kind: "CREW_FEE" | "EDITOR_RATE" | "SALARY" | "DIVIDEND" | "RESERVE";
  state: "PENDING_VERIFICATION" | "APPROVED" | "READY_FOR_DISBURSEMENT" | "PAID" | "VOID";
  payeeName: string;
  payeeType: "FREELANCE" | "INTERNAL" | "EQUITY";
  payeeRole: string | null;
  projectId: string | null;
  projectName: string | null;
  projectCode: string | null;
  roleLabel: string | null;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  earnedOn: string;
  slipNumber: string | null;
  payslipId: string | null;
};

export type PayrollSummary = {
  pendingPayout: number;
  currentMonthPayout: number;
  reserveAccumulated: number;
  dividendPending: number;
  readyCount: number;
  awaitingVerificationCount: number;
  canSeeDividends: boolean;
  periodLabel: string;
};

export type PayrollTab = "all" | "crew" | "editor" | "staff" | "equity";

const KIND_BY_TAB: Record<PayrollTab, PayrollLineItem["kind"][] | null> = {
  all: null,
  crew: ["CREW_FEE"],
  editor: ["EDITOR_RATE"],
  staff: ["SALARY"],
  equity: ["DIVIDEND"],
};

type RawLine = {
  id: string;
  kind: PayrollLineItem["kind"];
  state: PayrollLineItem["state"];
  payee_user_id: string | null;
  payee_crew_id: string | null;
  project_id: string | null;
  role_label: string | null;
  gross_amount: string | number;
  deduction_amount: string | number;
  net_amount: string | number;
  earned_on: string;
  payslip_id: string | null;
};

/**
 * Reads the KPI strip. Delegates to the executive RPC, which internally
 * degrades to the operational variant below rank 100 — so an ADMIN gets
 * operational totals and `canSeeDividends: false` rather than an error.
 */
export async function getPayrollSummary(): Promise<PayrollSummary> {
  const { rank } = await requirePageOps();
  const supabase = createServiceSupabase();

  /*
   * The rank is passed explicitly because this client is service-role and has
   * no JWT, so `auth.uid()` inside the function would be NULL and every call
   * would return FORBIDDEN (migration 0015). This RPC is executable only by
   * service_role, so a browser cannot reach it with a forged rank.
   */
  const { data, error } = await supabase.rpc("payroll_executive_summary", {
    p_caller_rank: rank,
  });
  if (error) {
    throw new Error(`payroll_executive_summary failed: ${error.message}`);
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => Number(v ?? 0) || 0;

  return {
    pendingPayout: num(raw.pending_payout),
    currentMonthPayout: num(raw.current_month_payout),
    reserveAccumulated: num(raw.reserve_accumulated),
    dividendPending: num(raw.dividend_pending),
    readyCount: num(raw.ready_count),
    awaitingVerificationCount: num(raw.awaiting_verification_count),
    canSeeDividends: raw.can_see_dividends === true,
    periodLabel: String(raw.period_label ?? ""),
  };
}

/**
 * Loads the master ledger for one tab.
 *
 * `rank` is resolved server-side by the caller's guard; it is NOT accepted from
 * the client. Dividend rows are excluded from the query entirely below
 * rank 100.
 */
export async function getPayrollLineItems(
  tab: PayrollTab = "all",
  periodKey?: string,
): Promise<PayrollLineItem[]> {
  const { rank } = await requirePageOps();
  const supabase = createServiceSupabase();
  const canSeeDividends = rank >= 100;

  const kinds = KIND_BY_TAB[tab] ?? null;

  let query = supabase
    .from("compensation_line_items")
    .select(`
      id, kind, state, payee_user_id, payee_crew_id, project_id,
      role_label, gross_amount, deduction_amount, net_amount, earned_on,
      payslip_id
    `)
    .neq("state", "VOID")
    .order("earned_on", { ascending: false })
    .limit(500);

  // Equity is invisible below FOUNDER — at the query, not the component.
  if (!canSeeDividends) {
    query = query.neq("kind", "DIVIDEND");
  }

  if (kinds) {
    query = query.in("kind", kinds);
  }

  if (periodKey && /^\d{4}-\d{2}$/.test(periodKey)) {
    // First day of month .. first day of next month (half-open, avoids
    // end-of-month arithmetic bugs).
    const [y, m] = periodKey.split("-").map(Number);
    const start = `${y}-${String(m).padStart(2, "0")}-01`;
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    const end = `${nextY}-${String(nextM).padStart(2, "0")}-01`;
    query = query.gte("earned_on", start).lt("earned_on", end);
  }

  const { data, error } = await query;
  if (error) throw new Error(`payroll ledger failed: ${error.message}`);

  const rows = (data ?? []) as RawLine[];
  if (rows.length === 0) return [];

  // Resolve display names in two batched lookups rather than N+1.
  const userIds = [...new Set(rows.map((r) => r.payee_user_id).filter(Boolean))] as string[];
  const crewIds = [...new Set(rows.map((r) => r.payee_crew_id).filter(Boolean))] as string[];
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))] as string[];
  const slipIds = [...new Set(rows.map((r) => r.payslip_id).filter(Boolean))] as string[];

  const [adminsRes, crewRes, projectsRes, slipsRes] = await Promise.all([
    userIds.length
      ? supabase.from("admins").select("user_id, display_name").in("user_id", userIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string }[] }),
    crewIds.length
      ? supabase.from("crew_members").select("id, full_name, crew_code").in("id", crewIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; crew_code: string }[] }),
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    slipIds.length
      ? supabase.from("payslip_records").select("id, slip_number").in("id", slipIds)
      : Promise.resolve({ data: [] as { id: string; slip_number: string }[] }),
  ]);

  const adminMap = new Map((adminsRes.data ?? []).map((a) => [a.user_id, a.display_name]));
  const crewMap = new Map((crewRes.data ?? []).map((c) => [c.id, c]));
  const projectMap = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));
  const slipMap = new Map((slipsRes.data ?? []).map((s) => [s.id, s.slip_number]));

  return rows.map((r) => {
    const crew = r.payee_crew_id ? crewMap.get(r.payee_crew_id) : undefined;
    const payeeName =
      (r.payee_user_id ? adminMap.get(r.payee_user_id) : undefined) ??
      crew?.full_name ??
      "Tanpa nama";

    return {
      id: r.id,
      kind: r.kind,
      state: r.state,
      payeeName,
      payeeType:
        r.kind === "DIVIDEND" ? "EQUITY" : r.payee_crew_id ? "FREELANCE" : "INTERNAL",
      payeeRole: crew?.crew_code ?? null,
      projectId: r.project_id,
      projectName: r.project_id ? (projectMap.get(r.project_id) ?? null) : null,
      projectCode: null,
      roleLabel: r.role_label,
      grossAmount: Number(r.gross_amount ?? 0),
      deductionAmount: Number(r.deduction_amount ?? 0),
      netAmount: Number(r.net_amount ?? 0),
      earnedOn: r.earned_on,
      slipNumber: r.payslip_id ? (slipMap.get(r.payslip_id) ?? null) : null,
      payslipId: r.payslip_id,
    };
  });
}

/** Advances one line item. State machine is enforced by a DB trigger. */
export async function advanceLineItemState(
  lineId: string,
  next: "APPROVED" | "READY_FOR_DISBURSEMENT" | "PAID",
): Promise<{ success: boolean; error?: string }> {
  const { user, rank } = await requirePageOps();
  const supabase = createServiceSupabase();

  const { data: line, error: readErr } = await supabase
    .from("compensation_line_items")
    .select("id, kind, state")
    .eq("id", lineId)
    .maybeSingle();

  if (readErr || !line) return { success: false, error: "Baris kompensasi tidak ditemukan." };

  // Deficiencies guard: an ADMIN may move operational pay, but paying out
  // dividend equity is an executive act.
  if (line.kind === "DIVIDEND" && rank < 100) {
    return { success: false, error: "Distribusi dividen hanya dapat diproses Founder." };
  }
  if (next === "PAID" && rank < 100) {
    return { success: false, error: "Pencairan dana hanya dapat dilakukan Founder." };
  }

  const patch: Record<string, unknown> = { state: next, updated_at: new Date().toISOString() };
  if (next === "PAID") patch.paid_at = new Date().toISOString();

  const { error } = await supabase
    .from("compensation_line_items")
    .update(patch)
    .eq("id", lineId);

  if (error) {
    // The DB trigger rejects backwards transitions; surface that verbatim.
    return { success: false, error: error.message };
  }

  void user;
  return { success: true };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Personal telemetry — the zero-leakage path
 * ───────────────────────────────────────────────────────────────────────────
 * `my_earnings_summary()` is called on the USER-SCOPED client, not the service
 * client. That is deliberate and is the opposite of `getPayrollSummary`:
 *
 *   • The function resolves identity from `auth.uid()` inside Postgres.
 *   • Passing the user's own JWT means the database, not the application,
 *     decides whose rows are summed.
 *   • A service-role call would have no JWT and return UNAUTHENTICATED — which
 *     is the correct failure, not a fallback to "show everything".
 */
export type MyEarnings = {
  pendingPayout: number;
  pendingCount: number;
  currentMonthPayout: number;
  lifetimePaid: number;
  awaitingVerificationCount: number;
  periodLabel: string;
};

export async function getMyEarnings(): Promise<MyEarnings | null> {
  const { createServerSupabase } = await import("@/lib/supabase/server");
  const supabase = await createServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_earnings_summary");
  if (error) {
    console.error("my_earnings_summary failed", { code: error.code });
    return null;
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => Number(v ?? 0) || 0;

  return {
    pendingPayout: num(raw.pending_payout),
    pendingCount: num(raw.pending_count),
    currentMonthPayout: num(raw.current_month_payout),
    lifetimePaid: num(raw.lifetime_paid),
    awaitingVerificationCount: num(raw.awaiting_verification_count),
    periodLabel: String(raw.period_label ?? ""),
  };
}

/**
 * Compensation KPI for the /admin command bar.
 *
 * Routes by rank, and each branch is a DIFFERENT data source by design:
 *
 *   rank < 80  (WORKER)   -> my_earnings_summary()  (own pay only)
 *   rank >= 80 (ADMIN+)   -> payroll_executive_summary(), which internally
 *                            degrades to the operational rollup below 100.
 *
 * The consequence that matters: a WORKER on /admin never triggers the payroll
 * rollup, so no other person's compensation is ever queried for that session.
 */
export async function getCompensationKpiForCaller(): Promise<{
  pendingPayout: number;
  pendingCount: number;
  currentMonthPayout: number;
} | null> {
  const { rank } = await requirePageStaff();

  if (rank < 80) {
    const mine = await getMyEarnings();
    if (!mine) return null;
    return {
      pendingPayout: mine.pendingPayout,
      pendingCount: mine.pendingCount + mine.awaitingVerificationCount,
      currentMonthPayout: mine.currentMonthPayout,
    };
  }

  const summary = await getPayrollSummary();
  return {
    pendingPayout: summary.pendingPayout,
    pendingCount: summary.readyCount + summary.awaitingVerificationCount,
    currentMonthPayout: summary.currentMonthPayout,
  };
}
