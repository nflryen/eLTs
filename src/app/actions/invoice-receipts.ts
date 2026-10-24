"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOps } from "@/lib/auth/roles";

/**
 * Client invoice receipt ledger — the ONLY write path for payments.
 *
 * WHY A DEDICATED FILE
 * --------------------
 * `src/lib/workspace.ts` is `server-only` and must never be imported from a
 * client component; `admin-invoices.ts` owns invoice creation and the public
 * client DTO. Recording money received is its own concern with its own
 * invariants, so it lives here as a thin `"use server"` boundary the invoice
 * panel can call.
 *
 * THE LEDGER CONTRACT (supabase/migrations/0001_consolidated_studio_os.sql)
 * ------------------------------------------------------------------------
 *   • Payments are ROWS in `invoice_payment_receipts`, never columns. The
 *     contract (`gross_contract_value`) is immutable, so a custom DP cannot
 *     corrupt the contract record.
 *   • `receipt_number` must match `^RCP/[0-9]{4}/[0-9]{2}/[0-9]{4}$`. That is
 *     produced by `public.next_document_number('RCP', 'YYYY-MM')` — atomic and
 *     gap-free per period, unlike a `RCP-${Date.now()}` guess that collides.
 *   • `amount` has `CHECK (amount <> 0)`: a zero is rejected at the DB, and we
 *     also reject non-positive values here so the client gets a clear message.
 *   • `verified_at IS NOT NULL` is the verification gate: ONLY verified rows
 *     count toward `paid_amount` / `balance_due` in
 *     `v_invoice_financial_position`. `verified` therefore decides whether the
 *     row moves the balance, so it is written explicitly.
 *   • A trigger (`trg_sync_payment_from_receipt`) recomputes
 *     `projects.is_dp_paid` / `is_fully_paid` on every insert/update/delete, so
 *     we never touch those columns directly.
 *
 * Every mutation is guarded by `requireAdmin()` and every field is validated
 * with zod before it reaches the database.
 */

const PAYMENT_METHODS = [
  "BANK_TRANSFER",
  "CASH",
  "QRIS",
  "E_WALLET",
  "CHEQUE",
  "CREDIT_NOTE",
] as const;

const APPLIED_TO = [
  "DP",
  "FINAL_BALANCE",
  "ADDON",
  "LATE_FEE",
  "DAMAGE",
  "UNALLOCATED",
] as const;

const uuidSchema = z.string().uuid();

const recordPaymentSchema = z.object({
  invoiceId: uuidSchema,
  amount: z
    .number({ error: "Nominal harus berupa angka." })
    .finite("Nominal tidak valid.")
    .positive("Nominal pembayaran harus lebih besar dari nol."),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: "Metode pembayaran tidak dikenal." }),
  bankName: z.string().trim().max(120).optional(),
  referenceNumber: z.string().trim().max(120).optional(),
  appliedTo: z.enum(APPLIED_TO, { error: "Alokasi pembayaran tidak dikenal." }),
  receivedAt: z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Tanggal pembayaran tidak valid.")
    .optional(),
  notes: z.string().trim().max(1000).optional(),
  verified: z.boolean(),
});

export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export type RecordPaymentResult = {
  success: boolean;
  receiptNumber?: string;
  error?: string;
};

/** `YYYY-MM` in Jakarta wall-clock time — the period key for RCP numbering. */
function jakartaPeriodKey(date: Date): string {
  // en-CA yields YYYY-MM-DD; slice to YYYY-MM.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
  }).format(date);
  return parts.slice(0, 7);
}

/**
 * The project console path a receipt belongs to. Receipts are revalidated here
 * so the derived balance in the workspace payload is refetched.
 */
function consolePath(projectId: string): string {
  return `/admin/projects/${projectId}`;
}

/**
 * Records a client payment against an invoice.
 *
 * The receipt number is minted server-side via the atomic document sequence —
 * never accepted from the caller, so two concurrent submissions can never
 * collide.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  try {
    const { admin, supabase } = await requireOps();

    const parsed = recordPaymentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Data pembayaran tidak valid.",
      };
    }
    const data = parsed.data;

    // Resolve the invoice → project so we can revalidate the right console and
    // refuse receipt rows against invoices that do not exist.
    const { data: invoice, error: invoiceErr } = await supabase
      .from("project_invoices")
      .select("id, project_id, is_cancelled")
      .eq("id", data.invoiceId)
      .maybeSingle();

    if (invoiceErr) {
      console.error("recordPayment: invoice lookup failed", invoiceErr);
      return { success: false, error: "Gagal memuat invoice." };
    }
    if (!invoice) {
      return { success: false, error: "Invoice tidak ditemukan." };
    }
    if (invoice.is_cancelled) {
      return { success: false, error: "Invoice sudah dibatalkan — pembayaran tidak dapat dicatat." };
    }

    const receivedAt = data.receivedAt ? new Date(data.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      return { success: false, error: "Tanggal pembayaran tidak valid." };
    }

    // Atomic, gap-free, per-period numbering: `RCP/YYYY/MM/NNNN`.
    const { data: receiptNumber, error: seqErr } = await supabase.rpc("next_document_number", {
      p_doc_type: "RCP",
      p_period_key: jakartaPeriodKey(receivedAt),
    });

    if (seqErr || typeof receiptNumber !== "string" || receiptNumber.length === 0) {
      console.error("recordPayment: next_document_number failed", seqErr);
      return { success: false, error: "Gagal membuat nomor kwitansi." };
    }

    const nowIso = new Date().toISOString();
    const verified = data.verified;

    const { error: insertErr } = await supabase.from("invoice_payment_receipts").insert({
      invoice_id: data.invoiceId,
      receipt_number: receiptNumber,
      amount: data.amount,
      currency: "IDR",
      payment_method: data.paymentMethod,
      bank_name: data.bankName || null,
      reference_number: data.referenceNumber || null,
      received_at: receivedAt.toISOString(),
      applied_to: data.appliedTo,
      verified_at: verified ? nowIso : null,
      verified_by: verified ? admin.user_id : null,
      notes: data.notes || null,
      created_by: admin.user_id,
    });

    if (insertErr) {
      console.error("recordPayment: insert failed", insertErr);
      return { success: false, error: insertErr.message };
    }

    revalidatePath(consolePath(invoice.project_id as string));
    revalidatePath("/admin/finance");
    revalidatePath("/admin");

    return { success: true, receiptNumber };
  } catch (error: unknown) {
    console.error("recordPayment failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Gagal mencatat pembayaran.",
    };
  }
}

const verifySchema = z.object({ receiptId: uuidSchema, projectId: uuidSchema });

/** Flips a receipt from "claim" to "cash" by stamping the verification gate. */
export async function verifyReceipt(
  receiptId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { admin, supabase } = await requireOps();

    const parsed = verifySchema.safeParse({ receiptId, projectId });
    if (!parsed.success) return { success: false, error: "ID tidak valid." };

    // Resolve the receipt's invoice and confirm it belongs to this project, so
    // a mismatched (receipt, project) pair cannot stamp another project's row.
    const { data: receipt } = await supabase
      .from("invoice_payment_receipts")
      .select("id, invoice_id, project_invoices!inner(project_id)")
      .eq("id", parsed.data.receiptId)
      .maybeSingle();

    const ownerProject = (
      receipt as unknown as { project_invoices: { project_id: string } | null } | null
    )?.project_invoices?.project_id;

    if (!receipt || ownerProject !== parsed.data.projectId) {
      return { success: false, error: "Kwitansi tidak ditemukan pada proyek ini." };
    }

    const { error } = await supabase
      .from("invoice_payment_receipts")
      .update({
        verified_at: new Date().toISOString(),
        verified_by: admin.user_id,
      })
      .eq("id", parsed.data.receiptId);

    if (error) {
      console.error("verifyReceipt failed", error);
      return { success: false, error: error.message };
    }

    revalidatePath(consolePath(parsed.data.projectId));
    revalidatePath("/admin/finance");
    revalidatePath("/admin");
    return { success: true };
  } catch (error: unknown) {
    console.error("verifyReceipt failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Gagal memverifikasi kwitansi.",
    };
  }
}

const deleteSchema = z.object({ receiptId: uuidSchema, projectId: uuidSchema });

/** Removes a receipt row. The projects payment trigger re-derives the flags. */
export async function deleteReceipt(
  receiptId: string,
  projectId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await requireOps();

    const parsed = deleteSchema.safeParse({ receiptId, projectId });
    if (!parsed.success) return { success: false, error: "ID tidak valid." };

    // Confirm ownership before deleting, so a mismatched pair cannot remove a
    // receipt on another project's invoice.
    const { data: receipt } = await supabase
      .from("invoice_payment_receipts")
      .select("id, project_invoices!inner(project_id)")
      .eq("id", parsed.data.receiptId)
      .maybeSingle();

    const ownerProject = (
      receipt as unknown as { project_invoices: { project_id: string } | null } | null
    )?.project_invoices?.project_id;

    if (!receipt || ownerProject !== parsed.data.projectId) {
      return { success: false, error: "Kwitansi tidak ditemukan pada proyek ini." };
    }

    const { error } = await supabase
      .from("invoice_payment_receipts")
      .delete()
      .eq("id", parsed.data.receiptId);

    if (error) {
      console.error("deleteReceipt failed", error);
      return { success: false, error: error.message };
    }

    revalidatePath(consolePath(parsed.data.projectId));
    revalidatePath("/admin/finance");
    revalidatePath("/admin");
    return { success: true };
  } catch (error: unknown) {
    console.error("deleteReceipt failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Gagal menghapus kwitansi.",
    };
  }
}
