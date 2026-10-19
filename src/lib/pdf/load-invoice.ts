import "server-only";
import { createServiceSupabase } from "@/lib/supabase/service";
import { site } from "@/config/site";
import type { InvoicePdfData } from "@/lib/pdf/invoice-document";

/**
 * Load everything the PDF needs in one place.
 *
 * Uses the service-role client because the caller (the API route) has already
 * proved authorisation with a signed token. The DTO comes from the database
 * rather than being assembled from multiple table reads, so the PDF cannot
 * disagree with what the client sees in the portal.
 */
export async function loadInvoicePdfData(invoiceId: string): Promise<InvoicePdfData | null> {
  const supabase = createServiceSupabase();

  const { data: invoice, error } = await supabase
    .from("project_invoices")
    .select("id, project_id, invoice_number, issue_date, due_date, line_items, client_notes, gross_contract_value")
    .eq("id", invoiceId)
    .maybeSingle();

  if (error || !invoice) return null;

  const { data: dto, error: dtoError } = await supabase.rpc("get_client_invoice_dto", {
    p_invoice_number: invoice.invoice_number,
  });
  if (dtoError || !dto || dto.error) return null;

  const typed = dto as {
    contract_value?: number;
    paid_amount?: number;
    balance_due?: number;
    payment_status?: string;
    payments?: Array<{ receipt_number: string; amount: number; received_at: string; bank_name: string | null }>;
    project?: { name?: string; shoot_date?: string | null };
    customer?: { name?: string; phone?: string | null; email?: string | null };
    studio_bank_details?: Array<{ bank: string; account_number: string; account_holder: string; label: string | null }>;
  };

  return {
    invoiceNumber: invoice.invoice_number,
    issueDate: invoice.issue_date ?? null,
    dueDate: invoice.due_date ?? null,
    lineItems: Array.isArray(invoice.line_items) ? invoice.line_items : [],
    clientNotes: invoice.client_notes ?? null,
    contractValue: Number(typed.contract_value ?? invoice.gross_contract_value ?? 0),
    paidAmount: Number(typed.paid_amount ?? 0),
    balanceDue: Number(typed.balance_due ?? 0),
    paymentStatus: typed.payment_status ?? "UNKNOWN",
    payments: (typed.payments ?? []).map((p) => ({
      receipt_number: p.receipt_number,
      amount: Number(p.amount),
      received_at: p.received_at,
      bank_name: p.bank_name ?? null,
      verified: true,
    })),
    project: {
      name: typed.project?.name ?? "Proyek",
      shootDate: typed.project?.shoot_date ?? null,
    },
    customer: {
      name: typed.customer?.name ?? "Klien",
      phone: typed.customer?.phone ?? null,
      email: typed.customer?.email ?? null,
    },
    bankDetails: typed.studio_bank_details ?? [],
    studioName: site.name,
  };
}
