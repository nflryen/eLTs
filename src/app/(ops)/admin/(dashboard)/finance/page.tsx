import type { Metadata } from "next";
import { requirePageFounder } from "@/lib/auth/roles";
import { getFinanceOverview } from "@/app/actions/admin-finance";
import { FinanceDashboardClient } from "@/components/admin/finance-dashboard-client";

export const metadata: Metadata = {
  title: "Finance & Waterfall Engine - Elts. Admin",
  robots: { index: false, follow: false },
};

export default async function AdminFinancePage() {
  /* Treasury is FOUNDER-only. Middleware already enforces this at rank 100; the page now agrees, so a direct render can never disagree with the route guard. */
  await requirePageFounder();

  const overviewResult = await getFinanceOverview();

  const initialData = overviewResult.success && overviewResult.data
    ? overviewResult.data
    : {
        totalGrossRevenue: 0,
        totalReserves: 0,
        pendingApprovalsCount: 0,
        approvedSplitsCount: 0,
        splits: [],
        ledgerEntries: [],
        availableProjects: [],
      };

  return (
    <div className="max-w-7xl mx-auto py-2">
      <FinanceDashboardClient initialData={initialData} />
    </div>
  );
}
