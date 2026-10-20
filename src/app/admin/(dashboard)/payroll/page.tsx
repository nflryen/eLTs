import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import {
  getPayrollLineItems,
  getPayrollSummary,
  getPayrollCycle,
} from "@/app/actions/payroll";
import { currentPayrollPeriod } from "@/lib/payroll/period";
import { PayrollHubClient } from "@/components/admin/payroll/payroll-hub-client";

export const metadata: Metadata = {
  title: "Payroll & Kompensasi - Elts. Admin",
  robots: { index: false, follow: false },
};

/**
 * Master Payroll & Compensation Hub.
 *
 * Access: SUPER_ADMIN, FOUNDER, ADMIN (rank >= 80). WORKER and FREELANCER are
 * redirected to `/admin?denied=unauthorized` by `requirePageOps()` — a 307, not
 * an error boundary.
 *
 * Redaction happens in `getPayrollLineItems()`: dividend rows are excluded from
 * the SQL below rank 100, so an ADMIN's payload never contains them.
 */
export default async function PayrollPage() {
  const { rank } = await requirePageOps();

  const period = currentPayrollPeriod();

  const [summary, lines, cycle] = await Promise.all([
    getPayrollSummary(),
    getPayrollLineItems("all"),
    getPayrollCycle(period),
  ]);

  return (
    <div className="mx-auto max-w-7xl py-2">
      <PayrollHubClient
        initialSummary={summary}
        initialLines={lines}
        initialCycle={cycle}
        rank={rank}
      />
    </div>
  );
}
