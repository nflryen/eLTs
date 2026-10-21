import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import { listLeads, getLeadCounts } from "@/app/actions/admin-leads";
import { LeadPipeline } from "@/components/admin/leads/lead-pipeline";

export const metadata: Metadata = {
  title: "Lead & Konsultasi — Elts.",
  robots: { index: false, follow: false },
};

/*
 * Consultation pipeline.
 *
 * Gated at ADMIN (80) to match the write policy from 0027. Read is allowed from
 * rank 60 in the database, but the UI is an operator tool — a WORKER has no
 * reason to see every prospective client's phone number.
 */
export default async function LeadsAdminPage() {
  await requirePageOps("/admin/leads");

  const [leads, counts] = await Promise.all([listLeads(), getLeadCounts()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a1aa]">
          Marketing
        </p>
        <h1 className="mt-1 text-xl font-semibold text-[#18181b]">Lead &amp; Konsultasi</h1>
        <p className="mt-1 text-sm text-[#71717a]">
          Semua permintaan konsultasi dari website. Tindak lanjuti, jadwalkan, atau
          konversi menjadi proyek.
        </p>
      </header>

      <LeadPipeline leads={leads} counts={counts} />
    </div>
  );
}
