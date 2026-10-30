import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("migration 0034 defines notification_logs and spreadsheet_sync_logs tables with strict invariants", () => {
  const sql = readFileSync("supabase/migrations/0034_notification_and_sync_ledger.sql", "utf-8");

  // Verify notification_logs structure
  assert.match(sql, /create table if not exists public\.notification_logs/);
  assert.match(sql, /channel\s+text not null check\s*\(channel in \('WHATSAPP', 'EMAIL'\)\)/);
  assert.match(sql, /status\s+text not null default 'PENDING' check\s*\(status in \('PENDING', 'SENT', 'FAILED', 'DELIVERED'\)\)/);
  assert.match(sql, /project_id\s+uuid references public\.projects\(id\)/);

  // Verify spreadsheet_sync_logs structure
  assert.match(sql, /create table if not exists public\.spreadsheet_sync_logs/);
  assert.match(sql, /entity_type\s+text not null check\s*\(entity_type in \('PROJECT', 'INVOICE', 'PAYMENT_RECEIPT', 'PROOFING_SELECTION'\)\)/);
  assert.match(sql, /status\s+text not null default 'PENDING' check\s*\(status in \('PENDING', 'SYNCED', 'FAILED'\)\)/);

  // Verify RBAC protection
  assert.match(sql, /create policy notification_logs_ops_read on public\.notification_logs/);
  assert.match(sql, /private\.has_role_rank\(80\)/);
  assert.match(sql, /create policy spreadsheet_sync_logs_ops_read on public\.spreadsheet_sync_logs/);
});

test("Google Apps Script template implements atomic locking, auth verification, and four core tabs", () => {
  const gas = readFileSync("docs/google-apps-script-sync-template.js", "utf-8");

  // Verify atomic script lock
  assert.match(gas, /LockService\.getScriptLock\(\)/);
  assert.match(gas, /lock\.waitLock\(10000\)/);
  assert.match(gas, /lock\.releaseLock\(\)/);

  // Verify auth header check
  assert.match(gas, /X-ELTS-SYNC-SECRET/i);

  // Verify all 4 tabs
  assert.match(gas, /"Projects Master"/);
  assert.match(gas, /"Invoices & Receivables"/);
  assert.match(gas, /"Cash Receipts Ledger"/);
  assert.match(gas, /"Proofing & Editor Queue"/);
});

test("Architecture blueprint enforces non-blocking fire-and-forget spreadsheet sync invariant", () => {
  const blueprint = readFileSync("docs/hybrid-notification-and-spreadsheet-sync-blueprint.md", "utf-8");

  assert.match(blueprint, /CRITICAL ARCHITECTURAL INVARIANT/);
  assert.match(blueprint, /spreadsheet synchronization must NEVER run synchronously inside a PostgreSQL transaction/);
  assert.match(blueprint, /WHATSAPP/);
  assert.match(blueprint, /EMAIL/);
  assert.match(blueprint, /Exponential Backoff/);
});
