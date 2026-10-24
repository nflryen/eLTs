import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import { listReferralCodes } from "@/app/actions/admin-referrals";
import { ReferralManagementClient } from "@/components/admin/referrals/referral-management-client";

export const metadata: Metadata = {
  title: "Kode Referral & Sales — Elts.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin management page for marketing partners & sales referral codes.
 * Gated to operations staff / admin (rank >= 80).
 */
export default async function AdminReferralsPage() {
  await requirePageOps("/admin/referrals");
  const codes = await listReferralCodes();

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
          Marketing &amp; Sales
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[#18181b]">Kode Referral &amp; Komisi</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Kelola kode diskon khusus untuk tim sales, affiliate, dan partner marketing.
        </p>
      </header>

      <ReferralManagementClient initialCodes={codes} />
    </div>
  );
}
