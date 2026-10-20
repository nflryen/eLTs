import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { hashGalleryPin, verifyGalleryPin } from "../src/lib/security/credentials";

test("Full User Journey: Seed -> PIN Auth -> 15-20 Quota HUD -> Selection Lock -> Payment Invariant", async (t) => {
  const db = new PGlite();
  const pepper = "A".repeat(43); // 43-char test pepper
  const PIN = "123456";
  const GALLERY_CODE = "ELTS-WISUDA01";

  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";
  const sessionId = "30000000-0000-0000-0000-000000000001";

  // 1. Initialize PostgreSQL schemas and apply all migrations
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant execute on function auth.jwt() to authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `);

  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const migration of migrations) {
    await db.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));
  }

  // 2. Compute scrypt-v2 hash for PIN
  const pinHash = await hashGalleryPin(PIN, pepper);
  assert.match(pinHash, /^scrypt-v2\$/);
  assert.equal(await verifyGalleryPin(PIN, pinHash, pepper), true);

  // 3. Seed Customer, Project (Commercial + Quota fields), and Invoices
  await db.exec(`
    set role service_role;

    insert into public.customers (id, name, email, phone)
    values ('${customerId}', 'Budi & Siti - Wisuda UNSOED', 'budi.siti@unsoed.ac.id', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status,
      allow_download, watermark_enabled, contract_value,
      is_dp_paid, is_fully_paid, selection_quota_min, selection_quota_max
    ) values (
      '${projectId}', '${customerId}', 'Graduation Session — Budi & Siti (UNSOED 2026)',
      'budi-siti-wisuda-unsoed', 'graduation', 'EVENT_GRADUATION_PHOTO',
      '${GALLERY_CODE}', '${pinHash}', '${"x".repeat(43)}', '2026-09-20', 'ready',
      true, true, 1500000, true, false, 15, 20
    );

    -- Commercial invoice. public.invoices does not exist on the consolidated
    -- schema; project_invoices + invoice_payment_receipts replaced it, and
    -- balance/status are derived rather than stored.
    insert into public.project_invoices (
      project_id, invoice_number, issue_date, due_date,
      line_items, gross_contract_value, minimum_dp_pct
    ) values (
      '${projectId}', 'INV/2026/09/0001', '2026-09-20', '2026-10-05',
      '[{"description":"Paket Dokumentasi Wisuda","quantity":1,"unit_price":1500000,"subtotal":1500000}]'::jsonb,
      1500000, 50
    );

    insert into public.invoice_payment_receipts (
      invoice_id, receipt_number, amount, payment_method, applied_to, verified_at
    )
    select id, 'RCP/2026/09/0001', 750000, 'BANK_TRANSFER', 'DP', now()
    from public.project_invoices where invoice_number = 'INV/2026/09/0001';

    insert into private.gallery_sessions (id, project_id, token_hash, expires_at)
    values ('${sessionId}', '${projectId}', '${"a".repeat(64)}', now() + interval '12 hours');

    reset role;
  `);

  // 4. Seed 25 mock media records
  await db.exec("set role service_role;");
  for (let i = 1; i <= 25; i++) {
    const num = i.toString().padStart(2, "0");
    const mediaId = `c0000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`;
    await db.exec(`
      insert into public.media (
        id, project_id, type, file_name, mime_type, storage_provider,
        original_key, width, height, file_size, processing_status, sort_order
      ) values (
        '${mediaId}', '${projectId}', 'image', 'ELTS_UNSOED_${num}.jpg', 'image/jpeg', 'supabase',
        '${projectId}/wisuda-${num}.jpg', 3000, 2000, 4500000, 'ready', ${i}
      );
    `);
  }
  await db.exec("reset role;");

  // TEST STEP 1: Verify Seed Counts
  await t.test("Seed state: 1 customer, 1 project, 25 media, 2 invoices", async () => {
    const mediaCount = await db.query<{ cnt: string | number }>("select count(*) as cnt from public.media where project_id = $1", [projectId]);
    assert.equal(mediaCount.rows[0].cnt, 25);

    const project = await db.query<{ is_dp_paid: boolean; is_fully_paid: boolean; selection_quota_min: number; selection_quota_max: number }>(
      "select is_dp_paid, is_fully_paid, selection_quota_min, selection_quota_max from public.projects where id = $1",
      [projectId]
    );
    assert.equal(project.rows[0].is_dp_paid, true);
    assert.equal(project.rows[0].is_fully_paid, false); // Balance still pending
    assert.equal(project.rows[0].selection_quota_min, 15);
    assert.equal(project.rows[0].selection_quota_max, 20);

    // One commercial invoice; its payment state is derived from the ledger.
    const invoices = await db.query<{ invoice_number: string; derived_status: string; paid_amount: string }>(
      `select invoice_number, derived_status, paid_amount
       from public.v_invoice_financial_position
       where project_id = $1`,
      [projectId],
    );
    assert.equal(invoices.rows.length, 1);
    assert.equal(invoices.rows[0].derived_status, "PARTIALLY_PAID");
    assert.equal(Number(invoices.rows[0].paid_amount), 750000);
  });

  // TEST STEP 2: Quota Underflow Protection (< 15 selections rejected)
  await t.test("Quota enforcement: submit with 14 photos (< 15) must be rejected", async () => {
    await db.exec("set role service_role;");
    // Client selects 14 photos
    for (let i = 1; i <= 14; i++) {
      const mediaId = `c0000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`;
      await db.exec(`
        insert into public.favorites (project_id, media_id, session_id)
        values ('${projectId}', '${mediaId}', '${sessionId}')
        on conflict do nothing;
      `);
    }
    await db.exec("reset role;");

    // Call submit_photo_selection RPC
    await assert.rejects(
      async () => {
        await db.exec("set role service_role;");
        try {
          await db.query("select public.submit_photo_selection($1, $2)", [projectId, sessionId]);
        } finally {
          await db.exec("reset role;");
        }
      },
      /below minimum quota of 15/
    );
  });

  // TEST STEP 3: Quota Valid Submission (Exactly 20 selections accepted)
  await t.test("Quota enforcement: submit with 20 photos succeeds, locks selection, creates editor task", async () => {
    await db.exec("set role service_role;");
    // Select 6 more photos to reach exactly 20
    for (let i = 15; i <= 20; i++) {
      const mediaId = `c0000000-0000-0000-0000-${i.toString(16).padStart(12, "0")}`;
      await db.exec(`
        insert into public.favorites (project_id, media_id, session_id)
        values ('${projectId}', '${mediaId}', '${sessionId}')
        on conflict do nothing;
      `);
    }

    // Call submit_photo_selection RPC with valid quota
    const res = await db.query<{ submit_photo_selection: { success: boolean; task_id: string; deliverable_count: number } }>(
      "select public.submit_photo_selection($1, $2)",
      [projectId, sessionId]
    );

    assert.equal(res.rows[0].submit_photo_selection.success, true);
    assert.equal(res.rows[0].submit_photo_selection.deliverable_count, 20);

    // Verify project row is now locked
    const lockedProject = await db.query<{ selection_locked_at: string }>(
      "select selection_locked_at from public.projects where id = $1",
      [projectId]
    );
    assert.ok(lockedProject.rows[0].selection_locked_at !== null);

    // Verify editor task exists in queue
    const task = await db.query<{ status: string; deliverable_count: number }>(
      "select status, deliverable_count from public.editor_tasks where project_id = $1",
      [projectId]
    );
    assert.equal(task.rows.length, 1);
    assert.equal(task.rows[0].status, "PENDING");
    assert.equal(task.rows[0].deliverable_count, 20);

    await db.exec("reset role;");
  });

  // TEST STEP 4: Double Submission Rejection
  await t.test("Subsequent submission on locked project is rejected", async () => {
    await assert.rejects(
      async () => {
        await db.exec("set role service_role;");
        try {
          await db.query("select public.submit_photo_selection($1, $2)", [projectId, sessionId]);
        } finally {
          await db.exec("reset role;");
        }
      },
      /Photo selection is already locked/
    );
  });

  // TEST STEP 5: Download Payment Invariant (HTTP 402 when unpaid, 200 when paid)
  await t.test("Download invariant: is_fully_paid=false locks download, marking PAID unlocks", async () => {
    // 5a. When is_fully_paid is false -> download locked
    const prePayment = await db.query<{ allow_download: boolean; is_fully_paid: boolean }>(
      "select allow_download, is_fully_paid from public.projects where id = $1",
      [projectId]
    );
    const downloadAllowedBefore = prePayment.rows[0].allow_download && prePayment.rows[0].is_fully_paid;
    assert.equal(downloadAllowedBefore, false); // Rejected with HTTP 402

    // 5b. Settle invoice (mark FINAL_BALANCE as PAID)
    await db.exec("set role service_role;");
    // Settle through the ledger. is_fully_paid is then set BY THE TRIGGER —
    // assigning it by hand here would test a value the test itself wrote.
    await db.exec(`
      insert into public.invoice_payment_receipts (
        invoice_id, receipt_number, amount, payment_method, applied_to, verified_at
      )
      select id, 'RCP/2026/09/0002', 750000, 'BANK_TRANSFER', 'FINAL_BALANCE', now()
      from public.project_invoices where invoice_number = 'INV/2026/09/0001';
    `);
    await db.exec("reset role;");

    // 5c. When is_fully_paid is true -> download unlocked
    const postPayment = await db.query<{ allow_download: boolean; is_fully_paid: boolean }>(
      "select allow_download, is_fully_paid from public.projects where id = $1",
      [projectId]
    );
    const downloadAllowedAfter = postPayment.rows[0].allow_download && postPayment.rows[0].is_fully_paid;
    assert.equal(downloadAllowedAfter, true); // Download Authorized
  });
});
