import { getDashboardTelemetry } from "@/app/actions/admin-dashboard";
import { readSectorLens } from "@/lib/sector-lens.server";
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
export default async function AdminHomePage() {
  const [telemetry, lens] = await Promise.all([getDashboardTelemetry(), readSectorLens()]);

  return (
    <div className="space-y-5">
      <SectorLens active={lens} />
      <AdminDashboard data={telemetry} />
    </div>
  );
}
