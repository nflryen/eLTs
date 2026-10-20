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

/* ───────────────────────────────────────────────────────────────────────────
 * Payroll cycle lifecycle
 * ───────────────────────────────────────────────────────────────────────────
 * Generation and disbursement are delegated to single plpgsql functions
 * (`generate_payroll_cycle`, `lock_payroll_cycle`, `disburse_payroll_cycle`)
 * because the Supabase client has no multi-statement transaction. A Server
 * Action looping over payees could fail half-way and leave a cycle that cannot
 * be reconciled; one function call is atomic by construction.
 *
 * Rank handling: the guard resolves rank from a real JWT, and that rank is
 * passed down so the function can enforce the same rule again. The functions
 * are executable by service_role ONLY, so a browser cannot call them with a
 * forged rank.
 */

export type GenerateCycleResult =
  | {
      success: true;
      cycleId: string;
      slipsCreated: number;
      linesSettled: number;
      totalDisbursement: number;
      reusedCycle: boolean;
    }
  | { success: false; error: string; message?: string; cycleId?: string };

export type CycleActionResult =
  | { success: true; cycleId: string; status: string; slips?: number; totalDisbursement?: number }
  | { success: false; error: string; message?: string };

type RpcRaw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => Number(v ?? 0) || 0;
const bool = (v: unknown) => v === true;

/*
 * `currentPayrollPeriod` lives in a separate module, NOT here.
 *
 * A `"use server"` file may export only async functions, so a synchronous helper
 * throws "Server Actions must be async functions" at build time — and a Client
 * Component importing it from here fails with "Export does not exist in target
 * module". It is a pure date computation, so it belongs in lib/ where both the
 * page and the client dialog can import it.
 */

/**
 * Pre-flight: what WOULD be generated, without writing anything.
 *
 * Used by the confirmation dialog so an operator sees headcount and total before
 * committing a pay period. There is no side effect here.
 */
export type CyclePreview = {
  lines: number;
  headcount: number;
  totalNet: number;
  dividendLines: number;
  existingCycleStatus: string | null;
};

export async function previewPayrollCycle(period: string): Promise<CyclePreview | null> {
  const { rank } = await requirePageOps();
  if (!/^\d{4}-\d{2}$/.test(period)) return null;

  const supabase = createServiceSupabase();
  const [y, m] = period.split("-").map(Number);
  const start = `${period}-01`;
  const end = `${String(m === 12 ? y + 1 : y)}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;

  let q = supabase
    .from("compensation_line_items")
    .select("id, kind, payee_crew_id, payee_user_id, net_amount")
    .in("state", ["APPROVED", "READY_FOR_DISBURSEMENT"])
    .is("payslip_id", null)
    .gte("earned_on", start)
    .lt("earned_on", end);

  // Dividends stay invisible to ADMIN, including in the preview.
  if (rank < 100) q = q.neq("kind", "DIVIDEND");

  const { data: rows } = await q;
  const list = (rows ?? []) as Array<Record<string, unknown>>;

  const payees = new Set(
    list.map((r) => (r.payee_user_id as string) ?? (r.payee_crew_id as string)),
  );

  const { data: cycle } = await supabase
    .from("payroll_cycles")
    .select("status")
    .eq("period_key", period)
    .maybeSingle();

  return {
    lines: list.length,
    headcount: payees.size,
    totalNet: list.reduce((s, r) => s + num(r.net_amount), 0),
    dividendLines: list.filter((r) => r.kind === "DIVIDEND").length,
    existingCycleStatus: (cycle as { status: string } | null)?.status ?? null,
  };
}

/**
 * Generate the cycle. Safe to call twice: the function reuses an open cycle and
 * the client-side duplicate guard (`payslip_id IS NULL`) means the second call
 * creates zero slips.
 */
export async function generatePayrollCycleAction(
  period: string,
  includeDividends = false,
): Promise<GenerateCycleResult> {
  const { rank } = await requirePageOps();

  if (rank < 80) {
    return { success: false, error: "FORBIDDEN" };
  }
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { success: false, error: "INVALID_PERIOD", message: "Format periode harus YYYY-MM." };
  }

  const supabase = createServiceSupabase();

  // Dividends are only ever included for a founder, regardless of the flag.
  const wantDividends = includeDividends && rank >= 100;

  const { data, error } = await supabase.rpc("generate_payroll_cycle", {
    p_period_key: period,
    p_caller_rank: rank,
    p_include_dividends: wantDividends,
  });

  if (error) {
    console.error("generate_payroll_cycle failed", { code: error.code });
    return { success: false, error: "RPC_ERROR", message: error.message };
  }

  const raw = (data ?? {}) as RpcRaw;

  if (!bool(raw.success)) {
    return {
      success: false,
      error: str(raw.error) || "UNKNOWN",
      message: str(raw.message) || undefined,
      cycleId: str(raw.cycle_id) || undefined,
    };
  }

  const cycleId = str(raw.cycle_id);
  const slipsCreated = num(raw.slips_created);

  /*
   * Sign each new slip.
   *
   * The HMAC seal is also defined in TypeScript (`payslip-token.ts`) because the
   * PDF route and the public verify page must compute the identical value. The
   * plpgsql function deliberately leaves `verification_hash = 'pending'` rather
   * than duplicating that algorithm in SQL, so it is written here, once.
   */
  if (slipsCreated > 0) {
    const secret = process.env.INVOICE_PDF_SECRET;
    if (!secret || secret.length < 32) {
      return {
        success: false,
        error: "SIGNING_NOT_CONFIGURED",
        message: "INVOICE_PDF_SECRET belum diatur; slip tidak dapat ditandatangani.",
        cycleId,
      };
    }

    const { signSlipVerification } = await import("@/lib/pdf/payslip-token");

    const { data: slips } = await supabase
      .from("payslip_records")
      .select("id, slip_number, total_net, verification_hash")
      .eq("payroll_cycle_id", cycleId)
      .eq("verification_hash", "pending");

    for (const s of (slips ?? []) as Array<Record<string, unknown>>) {
      const hash = signSlipVerification(
        String(s.id),
        String(s.slip_number),
        num(s.total_net),
        secret,
      );
      await supabase
        .from("payslip_records")
        .update({ verification_hash: hash })
        .eq("id", String(s.id));
    }
  }

  return {
    success: true,
    cycleId,
    slipsCreated,
    linesSettled: num(raw.lines_settled),
    totalDisbursement: num(raw.total_disbursement),
    reusedCycle: bool(raw.reused_cycle),
  };
}

/** Freeze the cycle for payment. Founder only. */
export async function lockPayrollCycleAction(cycleId: string): Promise<CycleActionResult> {
  const { rank, user } = await requirePageOps();
  if (rank < 100) {
    return { success: false, error: "FORBIDDEN", message: "Hanya Founder yang dapat mengunci siklus." };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("lock_payroll_cycle", {
    p_cycle_id: cycleId,
    p_caller_rank: rank,
    p_actor: user.id,
  });

  if (error) return { success: false, error: "RPC_ERROR", message: error.message };

  const raw = (data ?? {}) as RpcRaw;
  if (!bool(raw.success)) {
    return { success: false, error: str(raw.error) || "UNKNOWN", message: str(raw.message) || undefined };
  }
  return { success: true, cycleId, status: str(raw.status) || "LOCKED" };
}

/** Disburse. Founder only; marks slips + line items PAID and writes the ledger. */
export async function disbursePayrollCycleAction(cycleId: string): Promise<CycleActionResult> {
  const { rank, user } = await requirePageOps();
  if (rank < 100) {
    return { success: false, error: "FORBIDDEN", message: "Pencairan hanya dapat dilakukan Founder." };
  }

  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("disburse_payroll_cycle", {
    p_cycle_id: cycleId,
    p_caller_rank: rank,
    p_actor: user.id,
  });

  if (error) return { success: false, error: "RPC_ERROR", message: error.message };

  const raw = (data ?? {}) as RpcRaw;
  if (!bool(raw.success)) {
    return { success: false, error: str(raw.error) || "UNKNOWN", message: str(raw.message) || undefined };
  }
  return {
    success: true,
    cycleId,
    status: "DISBURSED",
    slips: num(raw.slips),
    totalDisbursement: num(raw.total_disbursement),
  };
}

/** The cycle for a period, for the status banner. */
export type PayrollCycleInfo = {
  id: string;
  periodKey: string;
  status: string;
  slipCount: number;
  totalNet: number;
};

export async function getPayrollCycle(period: string): Promise<PayrollCycleInfo | null> {
  await requirePageOps();
  const supabase = createServiceSupabase();

  const { data: cycle } = await supabase
    .from("payroll_cycles")
    .select("id, period_key, status")
    .eq("period_key", period)
    .maybeSingle();

  if (!cycle) return null;
  const c = cycle as { id: string; period_key: string; status: string };

  const { data: slips } = await supabase
    .from("payslip_records")
    .select("total_net")
    .eq("payroll_cycle_id", c.id);

  const list = (slips ?? []) as Array<{ total_net: number }>;

  return {
    id: c.id,
    periodKey: c.period_key,
    status: c.status,
    slipCount: list.length,
    totalNet: list.reduce((s, r) => s + num(r.total_net), 0),
  };
}
