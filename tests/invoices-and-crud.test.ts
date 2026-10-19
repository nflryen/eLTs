import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Client Invoices & CRUD Completeness: Commercial Invoices, Payment Sync Trigger & Zero-Leakage DTO", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";
  // Canonical document number: `INV/YYYY/MM/XXXX`, as minted by
  // public.next_document_number(). The previous "INV/20260928/WIS-UNSOED"
  // violated project_invoices_invoice_number_check.
  const invoiceNumber = "INV/2026/09/0001";

  // 1. Apply all 9 migrations
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
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

  // 2. Base fixture: Customer & Project initially marked unpaid
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone, email)
    values ('${customerId}', 'Budi & Siti - UNSOED', '081234567890', 'budi.siti@unsoed.ac.id');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status,
      contract_value, is_dp_paid, is_fully_paid
    ) values (
      '${projectId}', '${customerId}', 'Wisuda Ke-152 UNSOED Broadcast',
      'wisuda-152-unsoed', 'event', 'BROADCAST_LIVE_STREAMING',
      'ELTS-INV00001', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"i".repeat(43)}',
      '2026-09-28', 'ready', 15000000, false, false
    );
    reset role;
  `);

  /*
   * FIXTURE NOTE — derived balance model
   * ------------------------------------
   * `project_invoices` intentionally stores only `minimum_dp_pct`. Balance,
   * paid amount and status are DERIVED by `public.v_invoice_financial_position`
   * from `invoice_payment_receipts` (see 0001, "Balance and status are
   * DERIVED"). The earlier fixtures inserted `dp_amount` / `final_balance_amount`
   * / `payment_status`, which are not columns, and updated them directly —
   * columns that never existed and a sync trigger that only fires on receipts.
   *
   * These tests now drive the ledger, which is the real source of truth.
   */
  const insertReceipt = async (
    receiptNumber: string,
    amount: number,
    appliedTo: "DP" | "FINAL_BALANCE",
  ) => {
    await db.query(
      `insert into public.invoice_payment_receipts
         (invoice_id, receipt_number, amount, payment_method, applied_to, verified_at)
       select id, $1, $2, 'BANK_TRANSFER', $3, now()
       from public.project_invoices where invoice_number = $4`,
      [receiptNumber, amount, appliedTo, invoiceNumber],
    );
  };

  // =========================================================================
  // TEST 1: DP RECEIPT SATISFIES THE DEPOSIT FLOOR
  // =========================================================================
  await t.test("Invoice Trigger: verified DP receipt flips projects.is_dp_paid = true", async () => {
    await db.exec("set role service_role;");

    // Commercial invoice with a 30% deposit floor. No dp_amount column exists:
    // the floor is derived from gross_contract_value × minimum_dp_pct.
    await db.exec(`
      insert into public.project_invoices (
        project_id, invoice_number, issue_date, due_date,
        line_items, gross_contract_value, minimum_dp_pct
      ) values (
        '${projectId}', '${invoiceNumber}', '2026-09-28', '2026-10-05',
        '[
          {"description": "Paket Broadcast Live Streaming 4-Cam Pro", "quantity": 1, "unit_price": 12500000, "subtotal": 12500000},
          {"description": "Add-on: Dokumentasi Highlight Cinematic", "quantity": 1, "unit_price": 1500000, "subtotal": 1500000},
          {"description": "Add-on: Relay Videotron LED Graha Widyatama", "quantity": 1, "unit_price": 1000000, "subtotal": 1000000}
        ]'::jsonb,
        15000000, 50
      );
    `);

    const prePay = await db.query<{ is_dp_paid: boolean; is_fully_paid: boolean }>(
      "select is_dp_paid, is_fully_paid from public.projects where id = $1",
      [projectId]
    );
    assert.equal(prePay.rows[0].is_dp_paid, false);
    assert.equal(prePay.rows[0].is_fully_paid, false);

    // Client pays 50% deposit into the ledger.
    await insertReceipt("RCP/2026/09/0001", 7500000, "DP");

    // Invariant: trg_sync_payment_from_receipt derived dp_floor_satisfied
    // (7.5M >= 50% of 15M) and propagated it to projects.is_dp_paid.
    const postDp = await db.query<{ is_dp_paid: boolean; is_fully_paid: boolean }>(
      "select is_dp_paid, is_fully_paid from public.projects where id = $1",
      [projectId]
    );
    assert.equal(postDp.rows[0].is_dp_paid, true);
    assert.equal(postDp.rows[0].is_fully_paid, false, "balance still outstanding");

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 2: SETTLING THE BALANCE UNLOCKS THE PROJECT
  // =========================================================================
  await t.test("Invoice Trigger: settled balance flips projects.is_fully_paid = true", async () => {
    await db.exec("set role service_role;");

    await insertReceipt("RCP/2026/09/0002", 7500000, "FINAL_BALANCE");

    // paid 15,000,000 == contract 15,000,000 → derived_status PAID_IN_FULL
    const postFinal = await db.query<{ is_dp_paid: boolean; is_fully_paid: boolean }>(
      "select is_dp_paid, is_fully_paid from public.projects where id = $1",
      [projectId]
    );
    assert.equal(postFinal.rows[0].is_dp_paid, true);
    assert.equal(
      postFinal.rows[0].is_fully_paid,
      true,
      "full settlement must unlock the download gate",
    );

    // The derived position must agree with the trigger.
    const pos = await db.query<{ derived_status: string; paid_amount: string; balance_due: string }>(
      `select derived_status, paid_amount, balance_due
       from public.v_invoice_financial_position
       where invoice_number = $1`,
      [invoiceNumber],
    );
    assert.equal(pos.rows[0].derived_status, "PAID_IN_FULL");
    assert.equal(Number(pos.rows[0].paid_amount), 15000000);
    assert.equal(Number(pos.rows[0].balance_due), 0);

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 3: ZERO-LEAKAGE RPC (get_client_invoice_dto)
  // =========================================================================
  await t.test("Zero-Leakage Invariant: get_client_invoice_dto returns commercial rates, zero internal costs", async () => {
    await db.exec("set role service_role;");

    // Add internal expenses to the project (Koi Rental, Crew honor, etc.)
    await db.exec(`
      insert into public.project_expenses (
        project_id, category, name, unit_cost, quantity, paid_by, source_type, vendor_name
      ) values (
        '${projectId}', 'EQUIPMENT_RENTAL', 'Sony HXR-NX200 Sewa Koi', 400000, 1, 'STUDIO_CASH', 'VENDOR_RENTAL', 'Koi Rental'
      );
    `);

    // Call public get_client_invoice_dto
    const rpcRes = await db.query<{ get_client_invoice_dto: Record<string, unknown> }>(
      "select public.get_client_invoice_dto($1)",
      [invoiceNumber]
    );

    const dto = rpcRes.rows[0].get_client_invoice_dto;
    assert.ok(dto);

    /*
     * Contract shape as actually returned by get_client_invoice_dto:
     *   contract_value, paid_amount, balance_due, derived status, payments[].
     *
     * `gross_contract_value` and `studio_bank_details` are NOT part of this
     * payload. The earlier assertions read both, which is how the zero-leakage
     * test was failing: it expected fields the security-definer RPC
     * deliberately does not expose. Bank details are resolved by a separate
     * studio-level query, never per-invoice.
     */
    assert.equal(dto.invoice_number, invoiceNumber);
    assert.equal(dto.payment_status, "PAID_IN_FULL");
    assert.equal(Number(dto.contract_value), 15000000);
    assert.equal(Number(dto.paid_amount), 15000000);
    assert.equal(Number(dto.balance_due), 0);
    assert.equal((dto.customer as Record<string, unknown>).name, "Budi & Siti - UNSOED");
    assert.ok(Array.isArray(dto.line_items));
    assert.equal((dto.line_items as Array<unknown>).length, 3);
    assert.ok(Array.isArray(dto.payments));
    assert.equal((dto.payments as Array<unknown>).length, 2, "both receipts exposed");
    // Bank details ARE part of the client DTO (the customer needs somewhere to
    // pay). They are currently hardcoded inside the RPC — see
    // docs/known-issues.md; this assertion pins the current shape so any change
    // to that block is deliberate.
    assert.ok(Array.isArray(dto.studio_bank_details));

    // 2. Strict Zero-Leakage Invariants:
    // Internal expenses, margins, and vendor costs MUST be completely absent
    assert.equal(dto.direct_costs, undefined);
    assert.equal(dto.profit, undefined);
    assert.equal(dto.expenses, undefined);
    assert.equal(dto.vendor_costs, undefined);
    assert.equal(dto.crew_fees, undefined);

    await db.exec("reset role;");
  });
});
