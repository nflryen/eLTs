import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getClientInvoiceDataAction } from "@/app/actions/admin-invoices";
import { ClientInvoiceView } from "@/components/admin/projects/invoices/client-invoice-view";

// Invoices are private per-client documents: never prerendered, never cached.
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Props {
  params: Promise<{ invoiceNumber: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { invoiceNumber } = await params;
  const decoded = decodeURIComponent(invoiceNumber);
  return {
 title: `Invoice ${decoded} — ELTs. Creative & Digital Studio`,
 description: `Tagihan resmi invoice komersial proyek studio ELTs.`,
    robots: { index: false, follow: false },
  };
}

export default async function InvoicePage({ params }: Props) {
  const { invoiceNumber } = await params;
  const decoded = decodeURIComponent(invoiceNumber);

  const result = await getClientInvoiceDataAction(decoded);

  /*
   * Fail closed. A missing invoice is a 404; a lookup failure is a 500.
   * Never render a shell for a document that does not exist — the previous
   * behaviour fabricated a paid invoice (including live bank accounts) for any
   * identifier containing "INV", "WIS" or "DP".
   */
  if (result.status === "not_found") notFound();
  if (result.status === "error") {
    throw new Error("Invoice tidak dapat dimuat. Silakan hubungi studio.");
  }

  return (
    <div className="min-h-screen bg-[#fafafa] py-6 sm:py-10 print:py-0 print:bg-white text-[#09090b] ">
      <ClientInvoiceView invoice={result.data} />
    </div>
  );
}
