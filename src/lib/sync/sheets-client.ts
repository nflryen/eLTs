/**
 * Google Sheets Master Operational Ledger Synchronization Client
 * eLTs Visual Studio OS
 *
 * Provides cryptographic HMAC-SHA256 signed synchronization with Google Apps Script Webhooks.
 * Integrates directly with public.spreadsheet_sync_logs for auditability and non-blocking retry.
 */

import { createHmac } from "node:crypto";
import { createServiceSupabase } from "@/lib/supabase/service";
import type {
  SyncEntityType,
  SyncAction,
  SyncResult,
  ProjectSyncData,
  InvoiceSyncData,
  PaymentReceiptSyncData,
  ProofingSelectionSyncData,
  WebhookEnvelope,
  AnySyncData,
} from "./types";

/**
 * Computes an authentic HMAC-SHA256 signature for the sync payload.
 */
export function signSyncPayload(bodyString: string, secret: string): string {
  return createHmac("sha256", secret).update(bodyString).digest("hex");
}

/**
 * Helper to determine if the sync client should execute in mock mode.
 * Enabled during unit tests or when GOOGLE_SHEETS_WEBHOOK_URL is not set.
 */
function isMockMode(): boolean {
  return (
    !process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
    process.env.MOCK_SHEETS_SYNC === "true" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    (process.env.NODE_ENV === "test" && process.env.ENABLE_REAL_SHEETS_SYNC !== "true")
  );
}

/**
 * Low-level dispatch executor for Google Sheets synchronization.
 * Always executes asynchronously and never blocks or fails caller mutations.
 */
export async function dispatchSpreadsheetSync<T extends AnySyncData>(
  entityType: SyncEntityType,
  entityId: string,
  action: SyncAction,
  data: T
): Promise<SyncResult> {
  const timestamp = new Date().toISOString();
  let logId: string | undefined;

  // 1. Audit log initial attempt in public.spreadsheet_sync_logs
  try {
    const supabase = createServiceSupabase();
    const { data: logEntry, error: insertErr } = await supabase
      .from("spreadsheet_sync_logs")
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        action,
        sync_target: "GOOGLE_SHEETS",
        status: "PENDING",
        payload_snapshot: data as unknown as Record<string, unknown>,
        attempts: 1,
      })
      .select("id")
      .maybeSingle();

    if (!insertErr && logEntry) {
      logId = logEntry.id;
    }
  } catch (dbErr) {
    console.warn("[SheetsSync] Could not create spreadsheet_sync_logs entry:", dbErr);
  }

  // 2. Handle Mock Mode (Unit tests or unconfigured webhook)
  if (isMockMode()) {
    if (logId) {
      try {
        const supabase = createServiceSupabase();
        await supabase
          .from("spreadsheet_sync_logs")
          .update({
            status: "SYNCED",
            synced_at: timestamp,
          })
          .eq("id", logId);
      } catch {
        // ignore log update errors in mock mode
      }
    }

    return {
      success: true,
      sheet: `${entityType} Mock Tab`,
      row: Math.floor(Math.random() * 100) + 2,
      timestamp,
      isMock: true,
    };
  }

  // 3. Live Webhook Dispatch
  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL!;
  const secret = process.env.GOOGLE_SHEETS_SYNC_SECRET || "elts_dev_secret";
  const unixSeconds = String(Math.floor(Date.now() / 1000));

  const envelope: WebhookEnvelope<T> = {
    entityType,
    action,
    data,
    timestamp,
    secret,
  };

  const bodyString = JSON.stringify(envelope);
  const signature = signSyncPayload(bodyString, secret);

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ELTS-SYNC-SECRET": secret,
        "X-ELTS-SYNC-SIGNATURE": signature,
        "X-ELTS-TIMESTAMP": unixSeconds,
      },
      body: bodyString,
    });

    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      sheet?: string;
      row?: number;
      error?: string;
    } | null;

    const isSuccess = res.ok && Boolean(json?.success);

    // 4. Update ledger log
    if (logId) {
      const supabase = createServiceSupabase();
      if (isSuccess) {
        await supabase
          .from("spreadsheet_sync_logs")
          .update({
            status: "SYNCED",
            synced_at: new Date().toISOString(),
          })
          .eq("id", logId);
      } else {
        await supabase
          .from("spreadsheet_sync_logs")
          .update({
            status: "FAILED",
            last_error: json?.error || `HTTP ${res.status} from Google Apps Script`,
          })
          .eq("id", logId);
      }
    }

    return {
      success: isSuccess,
      sheet: json?.sheet,
      row: json?.row,
      error: json?.error || (!res.ok ? `HTTP ${res.status}` : undefined),
      timestamp,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (logId) {
      try {
        const supabase = createServiceSupabase();
        await supabase
          .from("spreadsheet_sync_logs")
          .update({
            status: "FAILED",
            last_error: errorMsg,
          })
          .eq("id", logId);
      } catch {
        // ignore
      }
    }

    return {
      success: false,
      error: errorMsg,
      timestamp,
    };
  }
}

// ── Domain-Specific Synchronization Helpers ──────────────────────────────────

/**
 * Synchronize project details to 'Projects Master' tab.
 */
export async function syncProjectToSheets(
  data: ProjectSyncData,
  action: SyncAction = "INSERT"
): Promise<SyncResult> {
  return dispatchSpreadsheetSync("PROJECT", data.id, action, data);
}

/**
 * Synchronize commercial invoice to 'Invoices & Receivables' tab.
 */
export async function syncInvoiceToSheets(
  data: InvoiceSyncData,
  action: SyncAction = "INSERT"
): Promise<SyncResult> {
  return dispatchSpreadsheetSync("INVOICE", data.id, action, data);
}

/**
 * Synchronize verified payment receipt to 'Cash Receipts Ledger' tab.
 */
export async function syncPaymentReceiptToSheets(
  data: PaymentReceiptSyncData,
  action: SyncAction = "INSERT"
): Promise<SyncResult> {
  return dispatchSpreadsheetSync("PAYMENT_RECEIPT", data.id, action, data);
}

/**
 * Synchronize client photo selection lock to 'Proofing & Editor Queue' tab.
 */
export async function syncProofingSelectionToSheets(
  data: ProofingSelectionSyncData,
  action: SyncAction = "INSERT"
): Promise<SyncResult> {
  return dispatchSpreadsheetSync("PROOFING_SELECTION", data.projectId, action, data);
}
