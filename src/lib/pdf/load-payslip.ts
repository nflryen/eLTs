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

/** Where the money is sent. A `null` part is unknown, not empty. */
export type PayslipBank = {
  name: string | null;
  accountNumber: string;
  holder: string | null;
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
  /**
   * Payout destination, resolved from `v_crew_identity`. Non-null only when an
   * account number is actually on file: a bank name alone is not a way to send
   * money, and printing one would read as a complete payment instruction.
   */
  bank: PayslipBank | null;
  /**
   * The payee is a crew member, yet no account number is on file. The slip
   * still renders — the amount and its verification hash are valid — but it
   * must carry an explicit "destination not set" marker. An omitted line reads
   * as "paid another way"; a blank account reads as corruption.
   */
  payoutDestinationIncomplete: boolean;
  status: string;
  issuedAt: string;
  totalGross: number;
  totalDeduction: number;
  totalNet: number;
  verificationHash: string;
  lines: PayslipLine[];
};

/** The slice of `v_crew_identity` a payslip needs. */
type CrewIdentitySlice = {
  crew_member_id: string;
  crew_code: string;
  display_full_name: string | null;
  bank_name: string | null;
  bank_account_holder: string | null;
  bank_account_number: string | null;
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

  /*
   * Identity and payout destination come from `public.v_crew_identity`, never
   * from `crew_members`.
   *
   * Both alternatives are wrong. Migration 0024 dropped `crew_members.bank_*`
   * outright, and even while those columns existed they were the wrong source:
   * /settings/profile writes `user_profiles`, so a slip built from
   * `crew_members` could pay a bank account its owner had already replaced,
   * with nothing telling them. The view resolves linked crew through
   * `user_profiles` and unlinked crew (no login, so nowhere else to store it)
   * through `crew_contact_details` — one read, correct for both populations.
   * Do not reintroduce a `crew_members` bank/name read here.
   *
   * A slip is keyed to a crew member OR to a user, but a user-keyed slip still
   * belongs to a crew member when that person has a crew row (Ray is both), so
   * falling back to `auth_user_id` keeps their destination on their own slip.
   */
  const identityKey = slip.payee_crew_id
    ? ({ column: "crew_member_id", value: slip.payee_crew_id } as const)
    : slip.payee_user_id
      ? ({ column: "auth_user_id", value: slip.payee_user_id } as const)
      : null;

  const [cycleRes, identityRes, adminRes, linesRes] = await Promise.all([
    supabase
      .from("payroll_cycles")
      .select("period_key, status")
      .eq("id", slip.payroll_cycle_id)
      .maybeSingle(),
    identityKey
      ? supabase
          .from("v_crew_identity")
          .select(
            "crew_member_id, crew_code, display_full_name, bank_name, bank_account_holder, bank_account_number",
          )
          .eq(identityKey.column, identityKey.value)
          // `auth_user_id` carries no unique constraint: a duplicated link must
          // degrade to "take one", not to an error on every slip download.
          .limit(1)
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

  const crew = identityRes.data as CrewIdentitySlice | null;
  const admin = adminRes.data as { display_name: string } | null;
  const cycle = cycleRes.data as { period_key: string; status: string } | null;

  const accountNumber = crew?.bank_account_number?.trim() || null;

  return {
    id: slip.id,
    slipNumber: slip.slip_number,
    periodKey: cycle?.period_key ?? "",
    payeeName: crew?.display_full_name ?? admin?.display_name ?? "Tanpa nama",
    // Only a crew-keyed slip carries a crew code. A user-keyed slip that happens
    // to resolve a crew row uses that row for the NAME and the payout
    // destination only: printing "CRW-RAY - Staff Internal" would contradict
    // itself, and the slip's FREELANCE/INTERNAL label is decided by how payroll
    // keyed the slip, not by this lookup.
    payeeCode: slip.payee_crew_id ? (crew?.crew_code ?? null) : null,
    payeeType: slip.payee_crew_id ? "FREELANCE" : "INTERNAL",
    payeeUserId: slip.payee_user_id,
    payeeCrewId: slip.payee_crew_id,
    bank: accountNumber
      ? {
          name: crew?.bank_name?.trim() || null,
          accountNumber,
          // Holder is normally the person; fall back to their own name rather
          // than printing "a/n" with nothing after it.
          holder: crew?.bank_account_holder?.trim() || crew?.display_full_name || null,
        }
      : null,
    payoutDestinationIncomplete: Boolean(crew) && !accountNumber,
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

/**
 * The single "where does this money go" line, shared by the printed PDF and the
 * admin screen so the two cannot drift apart. Exported because the exact marker
 * wording is the contract: it must say the destination is MISSING, not silently
 * omit the line. Null only when there is genuinely no destination to report.
 */
export function formatPayoutDestination(data: PayslipData): string | null {
  if (data.bank) {
    const institution = data.bank.name ? `${data.bank.name} ` : "";
    const holder = data.bank.holder ? ` a/n ${data.bank.holder}` : "";
    return `Rekening tujuan: ${institution}${data.bank.accountNumber}${holder}`;
  }
  if (data.payoutDestinationIncomplete) {
    return "Rekening tujuan: BELUM DIATUR - hubungi Studio Head";
  }
  return null;
}
