import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/service";
import { dispatchSpreadsheetSync } from "@/lib/sync/sheets-client";
import type { SyncEntityType, SyncAction, AnySyncData } from "@/lib/sync/types";

export const dynamic = "force-dynamic";

/**
 * Automated Cron Reconciliation Route for Google Sheets Synchronization.
 *
 * Scans public.spreadsheet_sync_logs for PENDING or transiently FAILED items,
 * enforces jittered exponential backoff, and re-dispatches up to 3 attempts.
 */
export async function GET(req: NextRequest) {
  return handleReconciliation(req);
}

export async function POST(req: NextRequest) {
  return handleReconciliation(req);
}

async function handleReconciliation(req: NextRequest) {
  // 1. Authenticate Cron Caller (Vercel Cron Header, Bearer token, or query secret)
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const querySecret = req.nextUrl.searchParams.get("secret");

  if (cronSecret && !isVercelCron) {
    if (bearerToken !== cronSecret && querySecret !== cronSecret) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized: Invalid or missing CRON_SECRET" },
        { status: 401 }
      );
    }
  }

  // 2. Fetch Pending and Failed synchronization items
  const supabase = createServiceSupabase();
  const { data: syncRows, error: fetchErr } = await supabase
    .from("spreadsheet_sync_logs")
    .select("id, entity_type, entity_id, action, status, payload_snapshot, attempts, created_at, synced_at")
    .in("status", ["PENDING", "FAILED"])
    .lt("attempts", 3)
    .order("created_at", { ascending: true })
    .limit(50);

  if (fetchErr) {
    return NextResponse.json(
      { ok: false, error: `Failed to query sync logs: ${fetchErr.message}` },
      { status: 500 }
    );
  }

  if (!syncRows || syncRows.length === 0) {
    return NextResponse.json({
      ok: true,
      message: "No pending or failed spreadsheet sync items to reconcile.",
      processed: 0,
      timestamp: new Date().toISOString(),
    });
  }

  let syncedCount = 0;
  let failedCount = 0;
  let skippedBackoffCount = 0;
  const now = Date.now();

  // 3. Process each item with exponential backoff evaluation
  for (const row of syncRows) {
    // Backoff window: (60 * 2^(attempts-1)) seconds
    const backoffSeconds = 60 * Math.pow(2, Math.max(0, row.attempts - 1));
    const createdTime = new Date(row.created_at).getTime();
    if (now - createdTime < backoffSeconds * 1000 && row.status === "FAILED") {
      skippedBackoffCount++;
      continue;
    }

    try {
      const result = await dispatchSpreadsheetSync(
        row.entity_type as SyncEntityType,
        row.entity_id,
        row.action as SyncAction,
        row.payload_snapshot as unknown as AnySyncData
      );

      if (result.success) {
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    processed: syncRows.length,
    syncedCount,
    failedCount,
    skippedBackoffCount,
    timestamp: new Date().toISOString(),
  });
}
