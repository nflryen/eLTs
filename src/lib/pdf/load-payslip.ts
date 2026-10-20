import "server-only";
import { createServiceSupabase } from "@/lib/supabase/service";

/**
 * Loads everything a payslip needs, in one place, for both the web view and the
 * PDF renderer — so the two can never disagree about a number.
 */

export type PayslipLine = {
  id: string;
  earnedOn: string;
  projectName: string | null;
  roleLabel: string | null;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
};

export type PayslipData = {
  id: string;
  slipNumber: string;
  periodKey: string;
  payeeName: string;
  payeeCode: string | null;
  payeeType: "FREELANCE" | "INTERNAL";
  payeeUserId: string | null;
  payeeCrewId: string | null;
  /** Bank destination. Null for internal staff paid by transfer with no record. */
  bank: { name: string; accountNumber: string; holder: string } | null;
  status: string;
  issuedAt: string;
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
  verificationHash: string;
  lines: PayslipLine[];
};

export async function loadPayslipData(slipId: string): Promise<PayslipData | null> {
  const supabase = createServiceSupabase();

  const { data: slip, error } = await supabase
    .from("payslip_records")
    .select(`
      id, slip_number, payroll_cycle_id, payee_user_id, payee_crew_id,
      total_gross, total_deduction, total_net, verification_hash, issued_at
    `)
    .eq("id", slipId)
    .maybeSingle();

  if (error || !slip) return null;

  const [cycleRes, crewRes, adminRes, linesRes] = await Promise.all([
    supabase
      .from("payroll_cycles")
      .select("period_key, status")
      .eq("id", slip.payroll_cycle_id)
      .maybeSingle(),
    slip.payee_crew_id
      ? supabase
          .from("crew_members")
          .select("full_name, crew_code, bank_name, bank_account_number, bank_account_holder")
          .eq("id", slip.payee_crew_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    slip.payee_user_id
      ? supabase.from("admins").select("display_name").eq("user_id", slip.payee_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("compensation_line_items")
      .select("id, earned_on, project_id, role_label, gross_amount, deduction_amount, net_amount")
      .eq("payslip_id", slipId)
      .neq("state", "VOID")
      .order("earned_on", { ascending: true }),
  ]);

  const projectIds = [
    ...new Set(((linesRes.data ?? []) as Array<{ project_id: string | null }>)
      .map((l) => l.project_id)
      .filter(Boolean)),
  ] as string[];

  const projectsRes = projectIds.length
    ? await supabase.from("projects").select("id, name").in("id", projectIds)
    : { data: [] as { id: string; name: string }[] };

  const projectMap = new Map((projectsRes.data ?? []).map((p) => [p.id, p.name]));

  const crew = crewRes.data as
    | { full_name: string; crew_code: string; bank_name: string | null; bank_account_number: string | null; bank_account_holder: string | null }
    | null;
  const admin = adminRes.data as { display_name: string } | null;
  const cycle = cycleRes.data as { period_key: string; status: string } | null;

  return {
    id: slip.id,
    slipNumber: slip.slip_number,
    periodKey: cycle?.period_key ?? "",
    payeeName: crew?.full_name ?? admin?.display_name ?? "Tanpa nama",
    payeeCode: crew?.crew_code ?? null,
    payeeType: slip.payee_crew_id ? "FREELANCE" : "INTERNAL",
    payeeUserId: slip.payee_user_id,
    payeeCrewId: slip.payee_crew_id,
    bank:
      crew && crew.bank_name && crew.bank_account_number
        ? {
            name: crew.bank_name,
            accountNumber: crew.bank_account_number,
            holder: crew.bank_account_holder ?? crew.full_name,
          }
        : null,
    status: cycle?.status ?? "DRAFT",
    issuedAt: slip.issued_at,
    totalGross: Number(slip.total_gross),
    totalDeduction: Number(slip.total_deduction),
    totalNet: Number(slip.total_net),
    verificationHash: slip.verification_hash,
    lines: ((linesRes.data ?? []) as Array<Record<string, unknown>>).map((l) => ({
      id: String(l.id),
      earnedOn: String(l.earned_on),
      projectName: l.project_id ? (projectMap.get(String(l.project_id)) ?? null) : null,
      roleLabel: (l.role_label as string | null) ?? null,
      grossAmount: Number(l.gross_amount ?? 0),
      deductionAmount: Number(l.deduction_amount ?? 0),
      netAmount: Number(l.net_amount ?? 0),
    })),
  };
}
