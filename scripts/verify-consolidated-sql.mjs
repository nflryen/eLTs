#!/usr/bin/env node
/**
 * verify:sql — offline validation of the consolidated migration.
 *
 * Runs `0001_consolidated_studio_os.sql` against an in-memory Postgres
 * (PGlite), twice, and asserts the resulting schema. Proves:
 *   1. The SQL is syntactically valid and applies cleanly.
 *   2. It is genuinely idempotent (a second apply is a no-op, not an error).
 *   3. Every required table/RPC materialises.
 *   4. The seed data lands.
 *
 * Runs with no network and no credentials, so it belongs in CI and pre-commit.
 *
 * USAGE
 *   npm run verify:sql
 *   npm run verify:sql -- --legacy     # also simulate a drifted hosted DB
 */

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(HERE, "..", "supabase", "migrations", "0001_consolidated_studio_os.sql");

/*
 * Migrations layered on top of 0001 by the multi-role workstream. They are
 * validated in the SAME in-memory database, after 0001, because they depend on
 * its `roles`/`permissions`/`role_assignments` spine. Applying them to a bare
 * database would prove nothing about the real deployment order.
 */
/*
 * Every migration after 0001, applied in filename order.
 *
 * Hand-picking "just the ones this pass needs" produced a chain that kept
 * growing (0012 needs 0013, 0016 needs 0013, 0021 needs 0012...). Applying the
 * real sequence is both simpler and more faithful: it is exactly what
 * `npm run migrate` does against a hosted database.
 */
const RBAC_MIGRATIONS = [
  "0002_rbac_core.sql",
  "0003_rbac_policies.sql",
  "0004_studio_payment_methods.sql",
  "0005_gallery_session_rpcs.sql",
  "0006_modernization_core.sql",
  "0007_rbac_access_repair.sql",
  "0008_crew_token_lifecycle.sql",
  "0009_inventory_worker_projection.sql",
  "0010_inventory_view_service_reader.sql",
  "0011_inventory_predicate_execute_grant.sql",
  "0012_payroll_identity_and_equity.sql",
  "0013_payroll_core_schema.sql",
  "0014_earnings_rpc_and_rls.sql",
  "0015_payroll_rpc_explicit_rank.sql",
  "0016_payroll_cycle_lock_and_audit.sql",
  "0017_generate_payroll_cycle_rpc.sql",
  "0018_payslip_numbering.sql",
  "0019_multi_role_session_context.sql",
  "0020_session_aware_roles.sql",
  "0021_user_profiles_and_payout.sql",
  "0022_session_listing_rpcs.sql",
];

const REQUIRED_TABLES = [
  "admins","customers","projects","media","favorites",
  "crew_members","project_crew_assignments","project_expenses","equipment_presets",
  "inventory_assets","outgoing_rental_orders","outgoing_rental_items",
  "project_invoices","invoice_payment_receipts",
  "vendor_purchase_orders","vendor_purchase_order_items",
  "portfolio_showcases","moodboard_cards","moodboard_comments",
  "studio_events","money_splits","cash_ledger","editor_tasks","inquiries",
  "document_sequences","schema_migrations",
];

const REQUIRED_RPCS = [
  "get_crew_hub_payload","get_client_invoice_dto","get_asset_utilization_calendar",
  "get_vendor_rental_manifest","next_document_number","check_asset_scheduling_conflict_v2",
  "approve_money_split","submit_photo_selection","respond_crew_assignment_offer",
  "create_gallery_session","resolve_gallery_session","revoke_gallery_session",
];

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures++; console.log(`  ✗ ${m}`); };

/** Minimal Supabase-shaped stubs so the migration can run on bare Postgres. */
async function stubPlatform(db) {
  const stmts = [
    `CREATE SCHEMA IF NOT EXISTS auth`,
    `CREATE SCHEMA IF NOT EXISTS storage`,
    `CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text)`,
    `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$`,
    `CREATE TABLE auth.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz)`,
    `CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$`,
    `CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[])`,
    `CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text)`,
    `CREATE ROLE anon`, `CREATE ROLE authenticated`, `CREATE ROLE service_role`,
  ];
  for (const s of stmts) await db.exec(s);
}

/** Build the drifted production shape: only the 5 legacy tables. */
async function seedLegacyShape(db) {
  const stmts = [
    `CREATE TYPE public.project_status AS ENUM ('draft','editing','ready','expired','archived')`,
    `CREATE TYPE public.photography_type AS ENUM ('wedding','prewedding','graduation','couple','event')`,
    `CREATE TYPE public.media_type AS ENUM ('image','video')`,
    `CREATE TABLE public.admins (user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, display_name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text, phone text, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE public.projects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT, name text NOT NULL, slug text NOT NULL UNIQUE, photography_type public.photography_type NOT NULL, gallery_code text NOT NULL UNIQUE, gallery_pin_hash text NOT NULL, access_token text NOT NULL UNIQUE, shoot_date date, cover_media_id uuid, status public.project_status NOT NULL DEFAULT 'draft', allow_download boolean NOT NULL DEFAULT false, watermark_enabled boolean NOT NULL DEFAULT true, expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE public.media (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, type public.media_type NOT NULL, file_name text NOT NULL, mime_type text NOT NULL, storage_provider text NOT NULL DEFAULT 'supabase', original_key text NOT NULL UNIQUE, thumbnail_key text UNIQUE, preview_key text UNIQUE, watermarked_thumbnail_key text UNIQUE, watermarked_preview_key text UNIQUE, cloudinary_public_id text UNIQUE, width integer, height integer, file_size bigint NOT NULL, duration_seconds numeric, processing_status text NOT NULL DEFAULT 'pending', sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE public.favorites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, media_id uuid NOT NULL, session_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    `ALTER TABLE public.projects ADD COLUMN contract_value numeric DEFAULT 0`,
    `ALTER TABLE public.projects ADD COLUMN service_pillar text`,
    `INSERT INTO public.customers (id,name,email) VALUES ('32ab584e-8fc0-4b07-9eba-8ea03257dcea','John Doe','john@example.com')`,
    `INSERT INTO public.projects (id,customer_id,name,slug,photography_type,gallery_code,gallery_pin_hash,access_token,shoot_date,status,contract_value,service_pillar) VALUES ('b575ecdc-385b-47fe-b044-6fcaca6ac141','32ab584e-8fc0-4b07-9eba-8ea03257dcea','OPENING & SEMINAR KOMDIGI','opening-seminar-komdigi','event','ELTS-AAAABBBB','scrypt-v1$abcdefghijklmnopqrstuv$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','2026-10-05','draft',25000000,'TECH_SOLUTION')`,
  ];
  for (const s of stmts) await db.exec(s);
}

async function assertSchema(db, label) {
  console.log(`\n  ── asserting schema (${label}) ──`);

  const { rows: tbl } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public' AND table_type='BASE TABLE'`,
  );
  const present = new Set(tbl.map((r) => r.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length === 0) {
    pass(`all ${REQUIRED_TABLES.length} required tables present`);
  } else {
    fail(`missing tables: ${missing.join(", ")}`);
  }

  const { rows: fns } = await db.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`,
  );
  const fnSet = new Set(fns.map((r) => r.proname));
  const missingFns = REQUIRED_RPCS.filter((f) => !fnSet.has(f));
  if (missingFns.length === 0) {
    pass(`all ${REQUIRED_RPCS.length} required RPCs present`);
  } else {
    fail(`missing RPCs: ${missingFns.join(", ")}`);
  }

  for (const [q, want, label2] of [
    [`SELECT count(*)::int n FROM public.crew_members`, 5, "5 crew members seeded"],
    [`SELECT count(*)::int n FROM public.inventory_assets`, 27, "27 inventory assets seeded"],
    [`SELECT count(*)::int n FROM public.equipment_presets`, 13, "13 equipment presets seeded"],
  ]) {
    const { rows } = await db.query(q);
    if (rows[0].n === want) {
      pass(label2);
    } else {
      fail(`${label2} — found ${rows[0].n}`);
    }
  }

  const { rows: v } = await db.query(
    `SELECT count(*)::int n FROM information_schema.views
     WHERE table_schema='public' AND table_name='v_invoice_financial_position'`,
  );
  if (v[0].n === 1) {
    pass("derived view v_invoice_financial_position");
  } else {
    fail("derived view missing");
  }
}

async function runPass({ legacy }) {
  const label = legacy ? "drifted legacy production shape" : "empty database";
  console.log(`\n  ══ PASS: applying over ${label} ══`);

  const db = new PGlite();
  await stubPlatform(db);

  if (legacy) {
    await seedLegacyShape(db);
    console.log("  legacy DB built: 5 tables, 1 project (drifted pillar)");
  }

  const sql = await readFile(MIGRATION, "utf8");
  try {
    await db.exec(sql);
    pass("migration applied cleanly");
  } catch (e) {
    fail(`migration failed: ${e.message}`);
    await db.close();
    return;
  }

  await assertSchema(db, label);

  if (legacy) {
    const { rows } = await db.query(
      `SELECT (SELECT count(*)::int FROM public.projects) p,
              (SELECT count(*)::int FROM public.customers) c,
              (SELECT contract_value::int FROM public.projects
                WHERE id='b575ecdc-385b-47fe-b044-6fcaca6ac141') cv,
              (SELECT service_pillar FROM public.projects
                WHERE id='b575ecdc-385b-47fe-b044-6fcaca6ac141') sp`,
    );
    const r = rows[0];
    if (r.c === 1) {
      pass("existing customer preserved");
    } else {
      fail(`customers lost (${r.c})`);
    }
    if (r.p === 1) {
      pass("existing project preserved");
    } else {
      fail(`projects lost (${r.p})`);
    }
    if (r.cv === 25000000) {
      pass("contract_value preserved (Rp 25,000,000)");
    } else {
      fail(`contract_value = ${r.cv}`);
    }
    if (r.sp === "BROADCAST_LIVE_STREAMING") {
      pass("drifted pillar normalised (TECH_SOLUTION → BROADCAST_LIVE_STREAMING)");
    } else {
      fail(`pillar not normalised: ${r.sp}`);
    }
  }

  console.log(`\n  ── idempotency: re-applying the same file ──`);
  try {
    await db.exec(sql);
    pass("second apply is clean (idempotent)");
  } catch (e) {
    fail(`re-apply failed: ${e.message}`);
  }

  await db.close();
}

console.log("\n  ═══════════════════════════════════════════════════════");
console.log("   ELTS Studio OS — consolidated migration validation");
console.log("  ═══════════════════════════════════════════════════════");

await runPass({ legacy: false });
await runMultiRolePass();
if (process.argv.includes("--legacy")) await runPass({ legacy: true });

/**
 * Applies the RBAC + multi-role migrations on top of 0001 and asserts that the
 * junction, session context, challenge tokens, and resolver RPCs all exist and
 * are idempotent.
 */
async function runMultiRolePass() {
  console.log("\n  ── multi-role stack (0001 + RBAC + session context) ──");

  const db = new PGlite();
  await stubPlatform(db);

  const base = await readFile(MIGRATION, "utf8");
  try {
    await db.exec(base);
  } catch (e) {
    fail(`0001 failed: ${e.message}`);
    await db.close();
    return;
  }

  for (const file of RBAC_MIGRATIONS) {
    const sql = await readFile(path.join(HERE, "..", "supabase", "migrations", file), "utf8");
    try {
      await db.exec(sql);
      pass(`${file} applied`);
    } catch (e) {
      fail(`${file} failed: ${e.message}`);
      await db.close();
      return;
    }
  }

  /* Schema assertions. */
  const { rows: tables } = await db.query(
    `select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE'`,
  );
  const names = new Set(tables.map((r) => r.table_name));
  for (const t of [
    "user_session_context",
    "role_challenge_tokens",
    "payout_challenge_tokens",
    "role_switch_audit",
    "user_profiles",
  ]) {
    if (names.has(t)) pass(`table ${t}`);
    else fail(`missing table ${t}`);
  }

  /* EDITOR must exist at rank 50. */
  const { rows: editor } = await db.query(
    `select rank from public.roles where key='EDITOR'`,
  );
  if (editor.length === 1 && Number(editor[0].rank) === 50) {
    pass("EDITOR role present at rank 50");
  } else {
    fail(`EDITOR role wrong: ${JSON.stringify(editor)}`);
  }

  /* role_assignments must now be a junction. */
  const { rows: pk } = await db.query(
    `select pg_get_constraintdef(oid) def from pg_constraint
      where conrelid='public.role_assignments'::regclass and contype='p'`,
  );
  const pkDef = pk[0]?.def ?? "";
  if (/user_id/.test(pkDef) && /role_key/.test(pkDef)) {
    pass("role_assignments has composite PK (user_id, role_key)");
  } else {
    fail(`role_assignments PK not composite: ${pkDef}`);
  }

  /* Required RPCs. */
  const { rows: fns } = await db.query(
    `select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public'`,
  );
  const fnNames = new Set(fns.map((r) => r.proname));
  for (const f of [
    "set_active_role",
    "get_my_role_context",
    "mint_role_challenge_token",
    "mint_payout_challenge_token",
    "update_payout_with_challenge",
    "list_my_sessions",
    "revoke_my_session",
  ]) {
    if (fnNames.has(f)) pass(`rpc ${f}`);
    else fail(`missing rpc ${f}`);
  }

  /*
   * Idempotency is asserted ONLY for the migrations this workstream authored.
   *
   * The earlier files are NOT re-appliable once 0019 has run: `0002` seeds
   * `role_permissions` with an `ON CONFLICT` that targets the old single-column
   * role_assignments key shape. Re-running 0002 after the junction change is not
   * a supported operation, and `scripts/migrate.mjs` never does it — it records
   * applied filenames and skips them. Asserting it here would test a sequence
   * that cannot occur in production.
   */
  console.log("\n  ── idempotency: re-applying the multi-role migrations ──");
  for (const file of [
    "0019_multi_role_session_context.sql",
    "0020_session_aware_roles.sql",
    "0021_user_profiles_and_payout.sql",
    "0022_session_listing_rpcs.sql",
  ]) {
    const sql = await readFile(path.join(HERE, "..", "supabase", "migrations", file), "utf8");
    try {
      await db.exec(sql);
      pass(`${file} re-applied cleanly`);
    } catch (e) {
      fail(`${file} re-apply failed: ${e.message}`);
    }
  }

  await db.close();
}

console.log("\n  ═══════════════════════════════════════════════════════");
if (failures === 0) {
  console.log("   ✓ ALL CHECKS PASSED\n");
  process.exit(0);
} else {
  console.log(`   ✗ ${failures} CHECK(S) FAILED\n`);
  process.exit(1);
}
