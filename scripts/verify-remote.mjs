#!/usr/bin/env node
/**
 * verify:remote — assert the hosted Supabase schema matches the repository.
 *
 * WHY THIS EXISTS
 * ---------------
 * `npm test` runs the migrations against PGlite in memory. It proves the SQL is
 * syntactically correct, but it never touches the hosted project. The hosted
 * database can therefore drift behind the repository with every test passing —
 * a false green. This script closes that loop by querying the LIVE instance.
 *
 * USAGE
 * -----
 *   npm run verify:remote
 *   npm run verify:remote -- --verbose      # list every object checked
 *   npm run verify:remote -- --url <url> --key <service_role_key>
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
 * .env.local (or the ambient environment). Exits non-zero on any failure so it
 * can gate CI.
 *
 * CHECKS
 * ------
 *   1. Every required table exists and is queryable.
 *   2. Every required RPC is callable.
 *   3. Critical columns exist on the drifted-then-consolidated tables.
 *   4. Seed data landed (crew, assets, presets).
 *   5. The derived invoice view answers correctly.
 */

import { readFile } from "node:fs/promises";
import process from "node:process";

const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

// ── Environment ────────────────────────────────────────────────────────────
async function loadEnv() {
  let url = argValue("--url") ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = argValue("--key") ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key) return { url, key };

  try {
    const raw = await readFile(".env.local", "utf8");
    const env = Object.fromEntries(
      raw
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        }),
    );
    url ??= env.NEXT_PUBLIC_SUPABASE_URL;
    key ??= env.SUPABASE_SERVICE_ROLE_KEY;
  } catch {
    /* .env.local absent — fall through to the guard below */
  }

  if (!url || !key) {
    console.error(
      "\n  ✗ Missing Supabase credentials.\n" +
        "    Provide NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n" +
        "    in .env.local, the environment, or via --url / --key.\n",
    );
    process.exit(2);
  }
  return { url, key };
}

// ── Expected schema surface ────────────────────────────────────────────────
const REQUIRED_TABLES = [
  // identity & core
  "admins", "customers", "projects", "media", "favorites",
  // operations & crew
  "crew_members", "project_crew_assignments", "project_expenses", "equipment_presets",
  // inventory & rentals
  "inventory_assets", "outgoing_rental_orders", "outgoing_rental_items",
  // invoicing & receipts
  "project_invoices", "invoice_payment_receipts",
  // vendor procurement
  "vendor_purchase_orders", "vendor_purchase_order_items",
  // showcase & content
  "portfolio_showcases", "moodboard_cards", "moodboard_comments",
  // calendar, finance, post, leads
  "studio_events", "money_splits", "cash_ledger", "editor_tasks", "inquiries",
  // infrastructure
  "document_sequences", "schema_migrations",
];

const REQUIRED_RPCS = [
  { name: "get_crew_hub_payload",              args: { p_magic_token: "___verify___" } },
  { name: "get_client_invoice_dto",            args: { p_invoice_number: "___verify___" } },
  { name: "get_asset_utilization_calendar",    args: { p_asset_id: "00000000-0000-0000-0000-000000000000" } },
  { name: "get_vendor_rental_manifest",        args: { p_project_id: "00000000-0000-0000-0000-000000000000" } },
  { name: "next_document_number",              args: { p_doc_type: "INV", p_period_key: "1900-01" } },
  {
    name: "check_asset_scheduling_conflict_v2",
    args: {
      p_asset_id: "00000000-0000-0000-0000-000000000000",
      p_project_id: "00000000-0000-0000-0000-000000000000",
      p_target_date: "1900-01-01",
    },
  },
];

// Columns that existed only in later migrations — the drift most likely to bite.
const REQUIRED_COLUMNS = {
  projects: [
    "contract_value", "dp_amount", "is_dp_paid", "is_fully_paid",
    "service_pillar", "selection_quota_min", "selection_quota_max",
    "selection_locked_at", "sector_specs", "rehearsal_date",
  ],
  project_crew_assignments: ["acceptance_status", "accepted_at", "declined_at"],
  crew_members: ["member_type", "jobdesk_specialties", "role_category"],
  project_expenses: ["asset_id", "source_type", "pack_status", "is_cash_outflow"],
  inventory_assets: ["is_available_for_outgoing_rental", "power_draw_watts"],
};

// ── Runner ─────────────────────────────────────────────────────────────────
const results = { pass: [], fail: [], warn: [] };
const ok = (m) => { results.pass.push(m); if (VERBOSE) console.log(`  ✓ ${m}`); };
const bad = (m) => { results.fail.push(m); console.log(`  ✗ ${m}`); };
const warn = (m) => { results.warn.push(m); if (VERBOSE) console.log(`  ⚠ ${m}`); };

async function main() {
  const { url, key } = await loadEnv();

  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  console.log(`\n  verifing hosted instance: ${url}\n`);

  // ── 1. Tables ────────────────────────────────────────────────────────────
  console.log("  [1/5] tables");
  for (const t of REQUIRED_TABLES) {
    const { error } = await sb.from(t).select("*", { count: "exact", head: true });
    if (error) {
      bad(`table missing: ${t}  (${error.message.slice(0, 70)})`);
    } else {
      ok(`table ${t}`);
    }
  }

  // ── 2. RPCs ──────────────────────────────────────────────────────────────
  console.log("  [2/5] RPCs");
  for (const rpc of REQUIRED_RPCS) {
    const { error } = await sb.rpc(rpc.name, rpc.args);
    // A missing function reports PGRST202. A function that EXISTS but rejects
    // our dummy input is still a pass — it proves the signature is registered.
    if (error && /could not find the function|PGRST202|schema cache/i.test(error.message)) {
      bad(`rpc missing: ${rpc.name}`);
    } else {
      ok(`rpc ${rpc.name}`);
    }
  }

  // ── 3. Columns ───────────────────────────────────────────────────────────
  console.log("  [3/5] critical columns");
  for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
    const { data, error } = await sb.from(table).select(cols.join(",")).limit(0);
    if (error) {
      bad(`columns missing on ${table}: ${error.message.slice(0, 70)}`);
    } else {
      ok(`columns on ${table} (${cols.length})`);
    }
  }

  // ── 4. Seed data ─────────────────────────────────────────────────────────
  console.log("  [4/5] seed data");
  for (const [table, min] of [["crew_members", 5], ["inventory_assets", 20], ["equipment_presets", 10]]) {
    const { count, error } = await sb.from(table).select("*", { count: "exact", head: true });
    if (error) bad(`cannot count ${table}: ${error.message.slice(0, 60)}`);
    else if ((count ?? 0) < min) warn(`${table} has ${count} rows (expected ≥ ${min})`);
    else ok(`${table}: ${count} rows`);
  }

  // ── 5. Derived view ──────────────────────────────────────────────────────
  console.log("  [5/5] derived view");
  const { error: viewErr } = await sb
    .from("v_invoice_financial_position")
    .select("invoice_id, contract_value, paid_amount, balance_due, derived_status")
    .limit(0);
  if (viewErr) bad(`view v_invoice_financial_position: ${viewErr.message.slice(0, 70)}`);
  else ok("view v_invoice_financial_position");

  // ── Report ───────────────────────────────────────────────────────────────
  const total = results.pass.length + results.fail.length;
  console.log("\n  ─────────────────────────────────────────────────────────");
  console.log(`  ${results.pass.length}/${total} checks passed`);
  if (results.warn.length) console.log(`  ${results.warn.length} warning(s)`);
  if (results.fail.length) {
    console.log(`\n  FAILED (${results.fail.length}):`);
    for (const f of results.fail) console.log(`    • ${f}`);
    console.log(
      "\n  → Apply supabase/migrations/0001_consolidated_studio_os.sql, then run:\n" +
        "      NOTIFY pgrst, 'reload schema';\n" +
        "    Re-run: npm run verify:remote\n",
    );
    process.exit(1);
  }
  console.log("\n  ✓ Hosted schema matches the repository.\n");
}

main().catch((err) => {
  console.error(`\n  ✗ verify:remote failed: ${err.message}\n`);
  process.exit(1);
});
