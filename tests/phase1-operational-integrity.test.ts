import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";
import { calculateWaterfallSplit } from "../src/lib/finance/waterfall";

test("Phase 1 Operational Integrity: Rescheduling Cascade, Two-Bucket Finance, Buffer Conflicts & Duplicate Blocker", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const project1Id = "b0000000-0000-0000-0000-000000000001";
  const project2Id = "b0000000-0000-0000-0000-000000000002";
  const crewMemberRay = "f0000000-0000-0000-0000-000000000001";
  const magicToken = randomBytes(32).toString("base64url");
  const assignmentId = "e1000000-0000-0000-0000-000000000001";

  // 1. Apply all 8 migrations
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

  // 2. Base fixture: Customer & Project initially scheduled for 2026-09-26 (Saturday)
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone)
    values ('${customerId}', 'PT Broadcast Client', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status, contract_value
    ) values 
      ('${project1Id}', '${customerId}', 'Wisuda Live Broadcast UNSOED',
       'wisuda-live-unsoed', 'event', 'BROADCAST_LIVE_STREAMING',
       'ELTS-LIVE0001', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"1".repeat(43)}',
       '2026-09-26', 'ready', 10000000),
      ('${project2Id}', '${customerId}', 'Corporate Event Rehearsal',
       'corporate-event-recce', 'event', 'BROADCAST_LIVE_STREAMING',
       'ELTS-RECC0001', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"2".repeat(43)}',
       '2026-09-25', 'ready', 5000000);
    reset role;
  `);

  // =========================================================================
  // ASSERTION 1: RESCHEDULING CASCADE & STALE CONSENT PURGE
  // =========================================================================
  await t.test("Rescheduling Cascade: shifting shoot_date invalidates crew consent and purges unconfirmed fee", async () => {
    await db.exec("set role service_role;");

    // 1a. Ray is assigned and has ACCEPTED the assignment for Saturday 2026-09-26
    await db.exec(`
      insert into public.project_crew_assignments (
        id, project_id, crew_member_id, magic_token, role_title,
        call_time, roll_time, venue_name, venue_address, fee_agreed,
        acceptance_status, accepted_at
      ) values (
        '${assignmentId}', '${project1Id}', '${crewMemberRay}', '${magicToken}',
        'Technical Director FOH', '2026-09-26T06:30:00+07:00', '2026-09-26T07:30:00+07:00',
        'Graha Widyatama UNSOED', 'Jl. HR Boenyamin', 500000,
        'ACCEPTED', now()
      );
    `);

    // Verify trigger trg_sync_crew_fee injected the expense
    const preReschedule = await db.query<{ count: string | number }>(
      "select count(*) as count from public.project_expenses where crew_assignment_id = $1",
      [assignmentId]
    );
    assert.equal(Number(preReschedule.rows[0].count), 1, "Accepted crew fee must exist in expenses");

    // 1b. Project date is rescheduled by 7 days to 2026-10-03
    await db.exec(`
      update public.projects
      set shoot_date = '2026-10-03'
      where id = '${project1Id}';
    `);

    // 1c. Verify cascade trigger trg_cascade_project_reschedule:
    const updatedAssignment = await db.query<{
      acceptance_status: string;
      accepted_at: string | null;
      call_time_wib: string;
      declined_reason: string;
    }>(
      "select acceptance_status, accepted_at, to_char(call_time at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') as call_time_wib, declined_reason from public.project_crew_assignments where id = $1",
      [assignmentId]
    );

    // Status MUST be reset to PENDING_OFFER
    assert.equal(updatedAssignment.rows[0].acceptance_status, "PENDING_OFFER");
    assert.equal(updatedAssignment.rows[0].accepted_at, null);
    assert.ok(updatedAssignment.rows[0].declined_reason.includes("Jadwal proyek diubah"));
    // Call time MUST have shifted by +7 days to 2026-10-03 in Jakarta local time
    assert.ok(updatedAssignment.rows[0].call_time_wib.includes("2026-10-03"));
    const postReschedule = await db.query<{ count: string | number }>(
      "select count(*) as count from public.project_expenses where crew_assignment_id = $1",
      [assignmentId]
    );
    assert.equal(Number(postReschedule.rows[0].count), 0, "Unconfirmed fee must be expunged from RAB upon reschedule");

    await db.exec("reset role;");
  });

  // =========================================================================
  // ASSERTION 2: DUPLICATE CREW FEE BLOCKER AT DATABASE LEVEL
  // =========================================================================
  await t.test("Duplicate Blocker: manual insert of CREW_FEE without crew_assignment_id is rejected by database constraint", async () => {
    await db.exec("set role service_role;");

    // Attempt to manually insert a CREW_FEE without a linked crew_assignment_id
    await assert.rejects(
      async () => {
        await db.exec(`
          insert into public.project_expenses (
            project_id, category, name, unit_cost, quantity, paid_by
          ) values (
            '${project1Id}', 'CREW_FEE', 'Honor Manual Duplikat', 500000, 1, 'STUDIO_CASH'
          );
        `);
      },
      /chk_crew_fee_requires_assignment/
    );

    await db.exec("reset role;");
  });

  // =========================================================================
  // ASSERTION 3: TWO-BUCKET EXPENSE ROUTING IN WATERFALL SPLIT
  // =========================================================================
  await t.test("Two-Bucket Finance: in-house gear depreciation does NOT reduce net cash profit", async () => {
    // Gross: Rp 10.000.000
    // Real Cash Outflows (Vendor rental + Freight): Rp 1.500.000
    // In-House Non-Cash Depreciation (vMix Rig Studio): Rp 750.000
    const math = calculateWaterfallSplit({
      grossRevenue: 10000000,
      directCosts: 1500000, // Only cash outflows passed as direct costs!
      nonCashDepreciation: 750000, // Informational only
      reservePct: 5.0,
      commissionPct: 5.0,
    });

    // Net Cash Profit MUST be 10M - 1.5M = 8.5M (NOT reduced by the 750k internal gear!)
    assert.equal(math.netProfit, 8500000);
    // Studio Reserve: 5% of 8.5M = 425.000
    assert.equal(math.reserveAmount, 425000);
    // Commission: 5% of 8.5M = 425.000
    assert.equal(math.commissionAmount, 425000);
    // Distributable Cash: 8.5M - 425k - 425k = 7.650.000
    assert.equal(math.remainder, 7650000);
    // Founder Shares: 50% each = 3.825.000
    assert.equal(math.founderAShare, 3825000);
    assert.equal(math.founderBShare, 3825000);
    // Non-cash depreciation is tracked cleanly for asset maintenance books
    assert.equal(math.nonCashDepreciation, 750000);
  });

  // =========================================================================
  // ASSERTION 4: BUFFER-AWARE CONFLICT DETECTION RPC (H-1 PREP COLLISION)
  // =========================================================================
  await t.test("Buffer-Aware Conflict RPC: detects collision on D-1 prep date", async () => {
    await db.exec("set role service_role;");

    // Fetch Sony FX3 Asset ID
    const fx3 = await db.query<{ id: string }>(
      "select id from public.inventory_assets where asset_code = 'AST-CAM-01'"
    );
    const fx3Id = fx3.rows[0].id;

    // Project 1 books Sony FX3 for event on 2026-10-03 (Saturday)
    await db.exec(`
      insert into public.project_expenses (
        project_id, category, name, unit_cost, quantity, asset_id, source_type, is_cash_outflow
      ) values (
        '${project1Id}', 'EQUIPMENT_RENTAL', 'Sony FX3 Cinema Body', 450000, 1, '${fx3Id}', 'IN_HOUSE', false
      );
    `);

    // Another project checks availability for Friday 2026-10-02 (D-1 of Project 1)
    // Old v1 checker would check exact date 2026-10-02 = 2026-10-03 -> FALSE (Misses conflict!)
    // New v2 checker with 1-day prep buffer detects collision!
    const conflictResult = await db.query<{
      conflict_found: boolean;
      conflicting_project_id: string;
      conflicting_project_name: string;
    }>(
      "select * from public.check_asset_scheduling_conflict_v2($1, $2, $3, 1, 1)",
      [fx3Id, project2Id, "2026-10-02"]
    );

    assert.equal(conflictResult.rows.length, 1);
    assert.equal(conflictResult.rows[0].conflict_found, true);
    assert.equal(conflictResult.rows[0].conflicting_project_id, project1Id);
    assert.ok(conflictResult.rows[0].conflicting_project_name.includes("Wisuda Live Broadcast"));

    // Date outside the buffer window (e.g. 2026-09-30, D-3) is clean
    const cleanResult = await db.query<{ conflict_found: boolean }>(
      "select * from public.check_asset_scheduling_conflict_v2($1, $2, $3, 1, 1)",
      [fx3Id, project2Id, "2026-09-30"]
    );
    assert.equal(cleanResult.rows.length, 0);

    await db.exec("reset role;");
  });
});
