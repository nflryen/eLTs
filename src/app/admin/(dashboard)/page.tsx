import { getDashboardTelemetry } from "@/app/actions/admin-dashboard";
import { readSectorLens } from "@/lib/sector-lens.server";
import { requireStaff } from "@/lib/auth/roles";
import { getCompensationKpiForCaller } from "@/app/actions/payroll";
import { CompensationKpiInline } from "@/components/admin/payroll/compensation-kpi-cards";
import { SectorLens } from "@/components/admin/sector-lens";
import { AdminDashboard } from "@/components/admin/dashboard/admin-dashboard";

/**
 * Admin home — executive dashboard.
 *
 * Authorisation lives in `getDashboardTelemetry()` via `requireStaff()`, so the
 * page itself holds no role logic. Restricted financial metrics are dropped
 * server-side (`state: "hidden"`), which means an ADMIN cannot recover Founder
 * figures from the client bundle even though both render the same component.
 *
 * `readSectorLens` is independent of telemetry and degrades to the default
 * sector on its own, so a lens failure cannot blank the dashboard.
 */
export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const [telemetry, lens, params, session, kpi] = await Promise.all([
    getDashboardTelemetry(),
    readSectorLens(),
    searchParams,
    requireStaff(),
    // Resolves per role: WORKER gets only their own figures via
    // my_earnings_summary(); ADMIN+ gets the payroll rollup.
    getCompensationKpiForCaller().catch(() => null),
  ]);

  /*
   * Two producers write here:
   *   • `middleware.ts`  → `?denied=<path>`     (route-level refusal)
   *   • `requirePageRole` → `?denied=unauthorized` (page-level refusal)
   *
   * Only a same-site admin path is echoed, and only after a shape check: a
   * hand-crafted `?denied=<script>` must never reach the DOM. Anything else
   * renders the generic sentence.
   */
  const SAFE_DENIED = /^\/admin(\/[A-Za-z0-9\-_/]*)?$/;
  const deniedTarget =
    params.denied && SAFE_DENIED.test(params.denied) ? params.denied : null;

  const deniedNotice = params.denied ? (
    <div
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3 text-sm text-[#78350f]"
    >
      <span className="shrink-0 font-semibold">Akses dibatasi.</span>
      <span>
        {deniedTarget ? (
          <>
            Halaman{" "}
            <code className="rounded bg-[#fef3c7] px-1">{deniedTarget}</code> hanya
            tersedia untuk peran dengan wewenang lebih tinggi.
          </>
        ) : (
          <>Halaman tersebut hanya tersedia untuk peran dengan wewenang lebih tinggi.</>
        )}{" "}
        Anda masuk sebagai <strong>{session.role ?? "Tanpa peran"}</strong>.
      </span>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {deniedNotice}
      <SectorLens active={lens} />
      {kpi ? <CompensationKpiInline data={kpi} /> : null}
      <AdminDashboard data={telemetry} rank={session.rank} />
    </div>
  );
}
