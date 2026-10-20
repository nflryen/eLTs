import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { getMyEarnings } from "@/app/actions/payroll";
import { CompensationKpiCards } from "@/components/admin/payroll/compensation-kpi-cards";
import { formatRupiah } from "@/lib/reminders/compose";

export const metadata: Metadata = {
  title: "Pendapatan Saya — Elts.",
  robots: { index: false, follow: false },
};

/*
 * Per-user page: reads the caller's session and renders THEIR earnings. There
 * is no dynamic route parameter, so without this directive Next.js prerenders
 * it at build time — which both fails the build (env unavailable during
 * prerender) and, when it succeeds, would cache one misleading artifact for a
 * page that must be unique per person.
 */
export const dynamic = "force-dynamic";

/**
 * Personal earnings for staff and freelancers who have a login.
 *
 * Zero-leakage contract: the ONLY data source is `my_earnings_summary()`, a
 * zero-argument SECURITY DEFINER RPC that resolves the caller from `auth.uid()`.
 * This page never receives a user id, so there is nothing to tamper with, and it
 * cannot be coerced into showing another person's pay.
 *
 * The crew portal at `/crew/[token]` is token-based and has no JWT, so this is
 * the authenticated equivalent for people who do have an account.
 */
export default async function MyEarningsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/admin/login");

  /*
   * Slips are read through the service client because the typed client in this
   * repo currently infers `never` for every table (pre-existing defect in the
   * checked-in `Database` shape: it does not satisfy postgrest-js's
   * GenericSchema, so the whole schema degrades to `any`).
   *
   * Safety does not depend on that type: the query is scoped to the caller's own
   * payslips by `payee_user_id`/`payee_crew_id` below, and RLS on
   * `payslip_records` enforces the same rule independently.
   */
  const slipsDb = createServiceSupabase();

  // Resolve the caller's crew identity (if any) so a freelancer sees their slips.
  const { data: crewRow } = await slipsDb
    .from("crew_members")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const crewId = (crewRow as { id: string } | null)?.id ?? null;

  const { data: slips } = await slipsDb
    .from("payslip_records")
    .select("id, slip_number, total_net, issued_at, payee_user_id, payee_crew_id")
    .or(
      crewId
        ? `payee_user_id.eq.${user.id},payee_crew_id.eq.${crewId}`
        : `payee_user_id.eq.${user.id}`,
    )
    .order("issued_at", { ascending: false })
    .limit(24);

  const mine = await getMyEarnings();
  if (!mine) redirect("/admin?denied=unauthorized");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#71717a] hover:text-[#09090b]"
      >
        <ArrowLeft size={12} /> Kembali
      </Link>

      <header className="mt-3 mb-5">
        <p className="eyebrow mb-1">Kompensasi</p>
        <h1 className="font-serif text-2xl font-bold tracking-tight text-[#09090b]">
          Pendapatan Saya
        </h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Periode aktif <strong className="text-[#09090b]">{mine.periodLabel || "—"}</strong>
        </p>
      </header>

      <CompensationKpiCards
        data={{
          pendingPayout: mine.pendingPayout,
          pendingCount: mine.pendingCount + mine.awaitingVerificationCount,
          currentMonthPayout: mine.currentMonthPayout,
        }}
      />

      <section className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#71717a]">
          Slip Gaji
        </h2>
        {slips && slips.length > 0 ? (
          <ul className="divide-y divide-[#f4f4f5] overflow-hidden rounded-[18px] border border-[#ececee] bg-white">
            {slips.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/payroll/slips/${s.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-[#fafafa]"
                >
                  <span className="flex items-center gap-2">
                    <FileText size={14} className="text-[#a1a1aa]" aria-hidden="true" />
                    <span className="font-mono text-xs text-[#09090b]">{s.slip_number}</span>
                  </span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-[#09090b]">
                    {formatRupiah(Number(s.total_net))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-[18px] border border-dashed border-[#d4d4d8] px-6 py-12 text-center">
            <FileText size={26} className="mx-auto mb-3 text-[#a1a1aa]" aria-hidden="true" />
            <p className="text-sm font-medium text-[#09090b]">Belum ada slip gaji</p>
            <p className="mt-1 text-xs text-[#71717a]">
              Slip diterbitkan setiap akhir siklus payroll bulanan.
            </p>
          </div>
        )}
      </section>

      <p className="mt-6 text-center font-mono text-[10px] text-[#a1a1aa]">
        Total sepanjang waktu: {formatRupiah(mine.lifetimePaid)}
      </p>
    </div>
  );
}
