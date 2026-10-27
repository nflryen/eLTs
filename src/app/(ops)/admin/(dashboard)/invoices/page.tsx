import type { Metadata } from "next";
import { requirePageOps } from "@/lib/auth/roles";
import {
  getGlobalInvoicesList,
  getRentalFormPrerequisites,
} from "@/app/actions/invoice-actions";
import { InvoicesHubClient } from "@/components/admin/invoices/invoices-hub-client";
import { getStudioBankAccounts } from "@/lib/studio/payment-methods";

export const metadata: Metadata = {
  title: "Faktur & Tagihan — Studio OS",
  robots: { index: false, follow: false },
};

export default async function AdminInvoicesPage() {
  await requirePageOps();

  const [overviewRes, prereqRes] = await Promise.all([
    getGlobalInvoicesList(),
    getRentalFormPrerequisites(),
  ]);

  const fallbackOverview = {
    invoices: [],
    metrics: {
      totalInvoiced: 0,
      totalCollected: 0,
      totalOutstanding: 0,
      countTotal: 0,
      countUnpaid: 0,
      countPartiallyPaid: 0,
      countPaid: 0,
    },
  };

  const initialOverview =
    overviewRes.success && overviewRes.data ? overviewRes.data : fallbackOverview;

  // Payment accounts are read once on the server and passed down, so client
  // components never embed account numbers.
  const bankAccounts = await getStudioBankAccounts();

  return (
    <div className="max-w-7xl mx-auto py-2">
      <InvoicesHubClient
        initialOverview={initialOverview}
        assets={prereqRes.assets ?? []}
        projects={prereqRes.projects ?? []}
        bankAccounts={bankAccounts}
      />
    </div>
  );
}
