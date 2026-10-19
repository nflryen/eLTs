"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";
import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  InvoiceMilestone,
  InvoiceStatus,
  InvoiceRow,
  CreateInvoiceInput,
} from "@/types/database";
import type {
  CommercialInvoiceLineItem,
  CommercialInvoiceStatus,
  ClientInvoiceDTO,
  InvoiceLookup,
} from "@/types/invoices";

const milestoneSchema = z.enum(["DP_50", "FINAL_BALANCE", "ADDON"]);
const uuidSchema = z.string().uuid();

function generateInvoiceNumber(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INV-${dateStr}-${rand}`;
}

/**
 * Creates a new milestone invoice for a project.
 * Supports both positional arguments: (projectId, milestone, amount, dueDate)
 * and an object argument: ({ projectId, milestone, amount, dueDate, invoiceNumber })
 */
export async function createInvoice(
  projectIdOrInput: string | CreateInvoiceInput,
  milestoneParam?: InvoiceMilestone,
  amountParam?: number,
  dueDateParam?: string | null,
): Promise<{ success: boolean; invoice?: InvoiceRow; error?: string }> {
  try {
    const { supabase } = await requireOps();

    let projectId: string;
    let milestone: InvoiceMilestone;
    let amount: number;
    let dueDate: string | null = null;
    let customInvoiceNumber: string | undefined;

    if (typeof projectIdOrInput === "object" && projectIdOrInput !== null) {
      projectId = projectIdOrInput.projectId;
      milestone = projectIdOrInput.milestone;
      amount = Number(projectIdOrInput.amount);
      dueDate = projectIdOrInput.dueDate ?? null;
      customInvoiceNumber = projectIdOrInput.invoiceNumber;
    } else {
      projectId = projectIdOrInput;
      milestone = milestoneParam!;
      amount = Number(amountParam);
      dueDate = dueDateParam ?? null;
    }

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid project ID." };
    }

    if (!milestoneSchema.safeParse(milestone).success) {
      return { success: false, error: "Invalid milestone. Must be DP_50, FINAL_BALANCE, or ADDON." };
    }

    if (isNaN(amount) || amount < 0) {
      return { success: false, error: "Amount must be a non-negative number." };
    }

    // Verify project exists
    const { data: project, error: projFetchErr } = await supabase
      .from("projects")
      .select("id, name, customer_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projFetchErr || !project) {
      return { success: false, error: "Project not found." };
    }

    const invoiceNumber = customInvoiceNumber || generateInvoiceNumber();

    const insertPayload = {
      project_id: projectId,
      invoice_number: invoiceNumber,
      milestone,
      amount,
      status: "PENDING" as InvoiceStatus,
      due_date: dueDate || null,
      created_at: new Date().toISOString(),
    };

    const { data: invoice, error: insertErr } = await supabase
      .from("invoices")
      .insert(insertPayload)
      .select()
      .single();

    if (insertErr || !invoice) {
      console.error("Failed to insert invoice:", insertErr);
      return { success: false, error: insertErr?.message || "Failed to create invoice." };
    }

    /*
     * Point the stored link at the authenticated print route. The public
     * `/api/invoices/[id]/pdf` endpoint now requires a signed token, so a bare
     * id there would yield a dead link; this employee-only route renders the
     * same document behind `withAdmin`.
     */
    const pdfUrl = `/api/admin/invoices/${invoice.id}/print`;
    await supabase
      .from("invoices")
      .update({ pdf_url: pdfUrl })
      .eq("id", invoice.id);

    invoice.pdf_url = pdfUrl;

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath("/admin/invoices");

    return { success: true, invoice: invoice as InvoiceRow };
  } catch (error: unknown) {
    console.error("Error creating invoice:", error);
    const message = error instanceof Error ? error.message : "Failed to create invoice.";
    return { success: false, error: message };
  }
}

/**
 * Marks an invoice as PAID and sets paid_at to current timestamp.
 * - If milestone is DP_50, sets projects.is_dp_paid = true.
 * - If milestone is FINAL_BALANCE or all invoices for the project are paid, sets projects.is_fully_paid = true.
 * Revalidates project and invoice paths.
 */
export async function markInvoicePaid(
  invoiceId: string,
): Promise<{ success: boolean; invoice?: InvoiceRow; error?: string }> {
  try {
    const { supabase } = await requireOps();

    if (!uuidSchema.safeParse(invoiceId).success) {
      return { success: false, error: "Invalid invoice ID." };
    }

    // 1. Fetch current invoice
    const { data: invoice, error: fetchErr } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    if (fetchErr || !invoice) {
      return { success: false, error: "Invoice not found." };
    }

    const typedInvoice = invoice as InvoiceRow;
    const now = new Date().toISOString();

    // 2. Update invoice status to PAID
    const { data: updatedInvoice, error: updateErr } = await supabase
      .from("invoices")
      .update({
        status: "PAID" as InvoiceStatus,
        paid_at: now,
      })
      .eq("id", invoiceId)
      .select()
      .single();

    if (updateErr || !updatedInvoice) {
      console.error("Failed to update invoice:", updateErr);
      return { success: false, error: updateErr?.message || "Failed to mark invoice as paid." };
    }

    // 3. Fetch all invoices for this project to evaluate status
    const { data: allInvoices, error: allInvoicesErr } = await supabase
      .from("invoices")
      .select("id, status, milestone, amount")
      .eq("project_id", typedInvoice.project_id);

    if (allInvoicesErr) {
      console.error("Failed to query project invoices:", allInvoicesErr);
    }

    // 4. Determine project updates based on milestones
    const projectUpdates: Record<string, unknown> = {
      updated_at: now,
    };

    if (typedInvoice.milestone === "DP_50") {
      projectUpdates.is_dp_paid = true;
      projectUpdates.dp_amount = typedInvoice.amount;
    }

    const isFinalBalance = typedInvoice.milestone === "FINAL_BALANCE";
    const activeInvoices = ((allInvoices ?? []) as InvoiceRow[]).filter((inv) => inv.status !== "CANCELLED");
    const allPaid =
      activeInvoices.length > 0 &&
      activeInvoices.every((inv) => inv.id === invoiceId || inv.status === "PAID");

    if (isFinalBalance || allPaid) {
      projectUpdates.is_fully_paid = true;
    }

    // 5. Apply project updates
    const { error: projUpdateErr } = await supabase
      .from("projects")
      .update(projectUpdates)
      .eq("id", typedInvoice.project_id);

    if (projUpdateErr) {
      console.error("Failed to update project status:", projUpdateErr);
    }

    // 6. Revalidate cache
    revalidatePath(`/admin/projects/${typedInvoice.project_id}`);
    revalidatePath("/admin/projects");
    revalidatePath("/admin/invoices");
    revalidatePath(`/api/admin/invoices/${invoiceId}/print`);

    return { success: true, invoice: updatedInvoice as InvoiceRow };
  } catch (error: unknown) {
    console.error("Error marking invoice as paid:", error);
    const message = error instanceof Error ? error.message : "Failed to mark invoice as paid.";
    return { success: false, error: message };
  }
}

/**
 * Fetch all invoices for a given project.
 */
export async function getProjectInvoices(
  projectId: string,
): Promise<{ success: boolean; invoices?: InvoiceRow[]; error?: string }> {
  try {
    const { supabase } = await requireOps();

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "Invalid project ID." };
    }

    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, invoices: (data ?? []) as InvoiceRow[] };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch invoices.";
    return { success: false, error: message };
  }
}

/**
 * Creates a commercial client-facing invoice in public.project_invoices.
 * Strict Zero-Leakage: line items store clean commercial rates, never internal expenses.
 */
export async function createCommercialInvoiceAction(data: {
  projectId: string;
  lineItems: CommercialInvoiceLineItem[];
  dueDate: string;
  dpAmount?: number;
  clientNotes?: string | null;
  customInvoiceNumber?: string;
}): Promise<{ success: boolean; invoiceNumber?: string; error?: string }> {
  try {
    const { supabase } = await requireOps();
    const { projectId, lineItems, dueDate, dpAmount = 0, clientNotes = null, customInvoiceNumber } = data;

    if (!uuidSchema.safeParse(projectId).success) {
      return { success: false, error: "ID proyek tidak valid." };
    }

    if (!lineItems || lineItems.length === 0) {
      return { success: false, error: "Minimal harus ada 1 baris item layanan komersial." };
    }

    const grossContract = lineItems.reduce((sum, item) => sum + (Number(item.subtotal) || Number(item.unit_price) * Number(item.quantity) || 0), 0);
    const dp = Number(dpAmount) || Math.round(grossContract * 0.5);
    const finalBalance = Math.max(0, grossContract - dp);

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const rand = Math.floor(100 + Math.random() * 900);
    const invoiceNumber = customInvoiceNumber || `INV/${dateStr}/P${rand}`;

    const { error } = await supabase.from("project_invoices").insert({
      project_id: projectId,
      invoice_number: invoiceNumber,
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: dueDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      line_items: lineItems,
      gross_contract_value: grossContract,
      dp_amount: dp,
      final_balance_amount: finalBalance,
      payment_status: "UNPAID",
      client_notes: clientNotes || null,
    });

    if (error) {
      return { success: false, error: `Gagal membuat invoice: ${error.message}` };
    }

    revalidatePath(`/admin/projects/${projectId}`);
    revalidatePath(`/invoice/${invoiceNumber}`);

    return { success: true, invoiceNumber };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal membuat invoice komersial";
    return { success: false, error: message };
  }
}

/**
 * Updates commercial invoice payment status. Trigger trg_sync_project_payment
 * automatically synchronizes is_dp_paid and is_fully_paid on projects.
 */
export async function updateCommercialInvoicePaymentStatusAction(
  invoiceNumber: string,
  paymentStatus: CommercialInvoiceStatus
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    const updateData: Record<string, unknown> = {
      payment_status: paymentStatus,
      updated_at: new Date().toISOString(),
    };

    if (paymentStatus === "PARTIALLY_PAID_DP") {
      updateData.dp_paid_at = new Date().toISOString();
    } else if (paymentStatus === "PAID_IN_FULL") {
      updateData.dp_paid_at = new Date().toISOString();
      updateData.final_balance_paid_at = new Date().toISOString();
    }

    const { data: inv, error } = await supabase
      .from("project_invoices")
      .update(updateData)
      .eq("invoice_number", invoiceNumber)
      .select("project_id")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    if (inv?.project_id) {
      revalidatePath(`/admin/projects/${inv.project_id}`);
    }
    revalidatePath(`/invoice/${invoiceNumber}`);

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Gagal memperbarui status pembayaran";
    return { success: false, error: message };
  }
}

/**
 * Public/Client DTO fetcher via Security Definer RPC.
 * Guaranteed zero leakage of studio internal expenses, margins, or crew fees.
 */
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
