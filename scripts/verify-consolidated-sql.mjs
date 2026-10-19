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
    `CREATE TABLE auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid())`,
    `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$`,
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
  missing.length === 0
    ? pass(`all ${REQUIRED_TABLES.length} required tables present`)
    : fail(`missing tables: ${missing.join(", ")}`);

  const { rows: fns } = await db.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`,
  );
  const fnSet = new Set(fns.map((r) => r.proname));
  const missingFns = REQUIRED_RPCS.filter((f) => !fnSet.has(f));
  missingFns.length === 0
    ? pass(`all ${REQUIRED_RPCS.length} required RPCs present`)
    : fail(`missing RPCs: ${missingFns.join(", ")}`);

  for (const [q, want, label2] of [
    [`SELECT count(*)::int n FROM public.crew_members`, 5, "5 crew members seeded"],
    [`SELECT count(*)::int n FROM public.inventory_assets`, 27, "27 inventory assets seeded"],
    [`SELECT count(*)::int n FROM public.equipment_presets`, 13, "13 equipment presets seeded"],
  ]) {
    const { rows } = await db.query(q);
    rows[0].n === want ? pass(label2) : fail(`${label2} — found ${rows[0].n}`);
  }

  const { rows: v } = await db.query(
    `SELECT count(*)::int n FROM information_schema.views
     WHERE table_schema='public' AND table_name='v_invoice_financial_position'`,
  );
  v[0].n === 1 ? pass("derived view v_invoice_financial_position") : fail("derived view missing");
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
    r.c === 1 ? pass("existing customer preserved") : fail(`customers lost (${r.c})`);
    r.p === 1 ? pass("existing project preserved") : fail(`projects lost (${r.p})`);
    r.cv === 25000000 ? pass("contract_value preserved (Rp 25,000,000)") : fail(`contract_value = ${r.cv}`);
    r.sp === "BROADCAST_LIVE_STREAMING"
      ? pass("drifted pillar normalised (TECH_SOLUTION → BROADCAST_LIVE_STREAMING)")
      : fail(`pillar not normalised: ${r.sp}`);
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
if (process.argv.includes("--legacy")) await runPass({ legacy: true });

console.log("\n  ═══════════════════════════════════════════════════════");
if (failures === 0) {
  console.log("   ✓ ALL CHECKS PASSED\n");
  process.exit(0);
} else {
  console.log(`   ✗ ${failures} CHECK(S) FAILED\n`);
  process.exit(1);
}
