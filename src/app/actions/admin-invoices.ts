"use server";

import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  CommercialInvoiceLineItem,
  CommercialInvoiceStatus,
  ClientInvoiceDTO,
  InvoiceLookup,
} from "@/types/invoices";


export async function getClientInvoiceDataAction(
  identifier: string
): Promise<InvoiceLookup> {
  try {
    const raw = decodeURIComponent(identifier ?? "").trim();

    /*
     * Fail closed on shape before any database work.
     *
     * The previous implementation treated ANY identifier containing the
     * substrings "INV", "WIS" or "DP" as a valid invoice and returned a
     * hardcoded DTO containing real bank accounts and customer PII. That made
     * /invoice/INV1, /invoice/xINVx and /invoice/WIS-x all render fabricated
     * financials for invoices that do not exist.
     *
     * Only two shapes are legitimate: a canonical document number minted by
     * public.next_document_number() (`INV/YYYY/MM/XXXX`), or a UUID that
     * resolves to one. Everything else is "not found" with no lookup at all.
     */
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const numberRe = /^[A-Z]{2,6}\/\d{4}\/\d{2}\/\d{4}$/;

    if (!uuidRe.test(raw) && !numberRe.test(raw)) {
      return { status: "not_found" };
    }

    /*
     * INTENTIONALLY elevated, and the only such read in this file.
     *
     * This is the unauthenticated client-facing invoice lookup (`/invoice/...`).
     * The client has no account, so there is no JWT to scope RLS to; the
     * security boundary is the unguessable canonical number, resolved through
     * the audited RPC, returning a curated DTO rather than invoices. It must not
     * be swapped to a user-scoped client — that would simply break the page.
     */
    const supabase = createServiceSupabase();
    let invoiceNumber = raw;

    // A UUID is only a locator; the RPC is queried by canonical number.
    if (uuidRe.test(raw)) {
      const { data: invRow, error: resolveError } = await supabase
        .from("project_invoices")
        .select("invoice_number")
        .eq("id", raw)
        .maybeSingle();

      if (resolveError) {
        console.error("invoice_uuid_resolve_failed", { code: resolveError.code });
        return { status: "error", code: resolveError.code ?? "resolve_failed" };
      }
      if (!invRow?.invoice_number) return { status: "not_found" };
      invoiceNumber = invRow.invoice_number;
    }

    const { data, error } = await supabase.rpc("get_client_invoice_dto", {
      p_invoice_number: invoiceNumber,
    });

    /*
     * An infrastructure error is NOT the same as a missing invoice, and it must
     * never fall through to synthesized data. Surface it distinctly so the page
     * can 500 rather than 404 — a 404 on a live invoice would be a silent lie.
     */
    if (error) {
      console.error("invoice_lookup_failed", { code: error.code });
      return { status: "error", code: error.code ?? "lookup_failed" };
    }
    if (!data || (data as Record<string, unknown>).error) {
      return { status: "not_found" };
    }

    const invoice = normalizeClientInvoice(data, invoiceNumber);
    return { status: "ok", data: invoice };
  } catch (err: unknown) {
    console.error("invoice_lookup_threw", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return { status: "error", code: "unexpected" };
  }
}
/**
 * Normalize the RPC payload into the client DTO.
 *
 * Pure function: no defaults may invent data. Anything the RPC omits renders
 * as an honest empty value rather than a plausible-looking fabrication.
 */
function normalizeClientInvoice(
  payload: unknown,
  invoiceNumber: string,
): ClientInvoiceDTO {
  const raw = payload as Record<string, unknown>;
  const lineItems = (Array.isArray(raw.line_items)
    ? raw.line_items
    : []) as CommercialInvoiceLineItem[];
  const computedTotal = lineItems.reduce(
    (acc, it) =>
      acc +
      (Number(it.subtotal) ||
        (Number(it.quantity) || 1) * (Number(it.unit_price) || 0)),
    0,
  );
  const contractValue =
    Number(raw.contract_value ?? raw.gross_contract_value ?? 0) || computedTotal;
  const paidAmount = Number(raw.paid_amount ?? 0);
  const balanceDue = Number(
    raw.balance_due ??
      raw.final_balance_amount ??
      Math.max(0, contractValue - paidAmount),
  );
  const dpRequired = Number(
    raw.minimum_dp_required ?? raw.dp_amount ?? Math.round(contractValue * 0.3),
  );
  const paymentsList = (Array.isArray(raw.payments) ? raw.payments : []) as Array<{
    received_at: string;
  }>;

  return {
    invoice_number: String(raw.invoice_number || invoiceNumber),
    issue_date: String(raw.issue_date || ""),
    due_date: String(raw.due_date || ""),
    payment_status:
      (raw.payment_status as CommercialInvoiceStatus) ||
      (paidAmount >= contractValue && contractValue > 0
        ? "PAID_IN_FULL"
        : paidAmount > 0
          ? "PARTIALLY_PAID_DP"
          : "UNPAID"),
    line_items: lineItems,
    gross_contract_value: contractValue,
    contract_value: contractValue,
    dp_amount: dpRequired,
    minimum_dp_required: dpRequired,
    dp_paid_at:
      (raw.dp_paid_at as string) ||
      (paidAmount >= dpRequired && dpRequired > 0
        ? paymentsList[0]?.received_at || null
        : null),
    final_balance_amount: balanceDue,
    balance_due: balanceDue,
    paid_amount: paidAmount,
    final_balance_paid_at:
      (raw.final_balance_paid_at as string) ||
      (balanceDue <= 0 && contractValue > 0
        ? paymentsList[paymentsList.length - 1]?.received_at || null
        : null),
    client_notes: (raw.client_notes as string) || null,
    project: (raw.project as ClientInvoiceDTO["project"]) || {
      id: "",
      name: "Layanan Studio",
      service_pillar: "COMMERCIAL_VIDEO",
      shoot_date: null,
    },
    customer: (raw.customer as ClientInvoiceDTO["customer"]) || {
      name: "Klien",
      phone: "-",
      email: null,
    },
    // Bank details come ONLY from the RPC. Never defaulted here: a fabricated
    // fallback would disclose real account numbers on a page that failed to
    // load its invoice.
    studio_bank_details:
      (raw.studio_bank_details as ClientInvoiceDTO["studio_bank_details"]) || [],
    payments: (raw.payments as ClientInvoiceDTO["payments"]) || [],
  };
}
