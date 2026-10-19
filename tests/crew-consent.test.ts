import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";

test("Dual-Consent State Machine: PENDING_OFFER -> ACCEPTED (Syncs RAB) / DECLINED (Clean)", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";
  const tokenAccepted = randomBytes(32).toString("base64url");
  const tokenDeclined = randomBytes(32).toString("base64url");

  // 1. Initialize DB with all 7 migrations (including 0007)
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

  // 2. Base fixtures: Customer, Project & Verify Core/Freelancer Crew Seeding
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone)
    values ('${customerId}', 'PT Live Broadcast Client', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status
    ) values 
      ('${projectId}', '${customerId}', 'Konser Musik Purwokerto Broadcast',
       'konser-musik-purwokerto', 'event', 'BROADCAST_LIVE_STREAMING',
       'ELTS-KONSER02', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"3".repeat(43)}',
       '2026-10-05', 'ready');
    reset role;
  `);

  // Verify seeded crew members from migration 0007
  await t.test("Seed Verification: Core team (Ray, El, Cahyo) and Freelancers (Azrian, Fatteh) exist", async () => {
    await db.exec("set role service_role;");
    const crew = await db.query<{ crew_code: string; full_name: string; member_type: string }>(
      "select crew_code, full_name, member_type from public.crew_members order by crew_code"
    );
    assert.ok(crew.rows.length >= 5, "Should have at least 5 seeded crew members");

    const ray = crew.rows.find((c) => c.crew_code === "CRW-RAY");
    assert.ok(ray);
    assert.equal(ray.member_type, "CORE_TEAM");

    const azrian = crew.rows.find((c) => c.crew_code === "CRW-AZR");
    assert.ok(azrian);
    assert.equal(azrian.member_type, "FREELANCE");
    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 1: PENDING_OFFER DOES NOT CREATE AN EXPENSE ROW
  // =========================================================================
  await t.test("Pending Offer Isolation: inserting assignment with PENDING_OFFER keeps project_expenses empty", async () => {
    await db.exec("set role service_role;");

    const rayId = "f0000000-0000-0000-0000-000000000001";

    // Offer sent to Ray as Technical Director with offered fee Rp 500.000
    await db.exec(`
      insert into public.project_crew_assignments (
        project_id, crew_member_id, magic_token, role_title, call_time,
        venue_name, venue_address, fee_agreed, acceptance_status
      ) values (
        '${projectId}', '${rayId}', '${tokenAccepted}',
        'FOH Technical Director', '2026-10-05T06:30:00+07:00',
        'Gor Satria Purwokerto', 'Jl. Prof. Dr. Suharso', 500000,
        'PENDING_OFFER'
      );
    `);

    // Verify trigger trg_sync_crew_fee DID NOT insert into project_expenses
    const expenses = await db.query<{ count: string | number }>(
      "select count(*) as count from public.project_expenses where project_id = $1",
      [projectId]
    );
    assert.equal(Number(expenses.rows[0].count), 0, "Expenses must remain 0 when offer is pending");

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 2: ACCEPTING OFFER (respond_crew_assignment_offer -> true)
  // =========================================================================
  await t.test("Offer Acceptance: worker accepts offer -> transitions to ACCEPTED -> syncs CREW_FEE to RAB", async () => {
    await db.exec("set role service_role;");

    // Worker invokes respond_crew_assignment_offer with accept: true
    const res = await db.query<{ respond_crew_assignment_offer: { success: boolean; status: string } }>(
      "select public.respond_crew_assignment_offer($1, true)",
      [tokenAccepted]
    );

    assert.equal(res.rows[0].respond_crew_assignment_offer.success, true);
    assert.equal(res.rows[0].respond_crew_assignment_offer.status, "ACCEPTED");

    // Verify assignment row has accepted_at timestamp
    const assignment = await db.query<{ acceptance_status: string; accepted_at: string }>(
      "select acceptance_status, accepted_at from public.project_crew_assignments where magic_token = $1",
      [tokenAccepted]
    );
    assert.equal(assignment.rows[0].acceptance_status, "ACCEPTED");
    assert.ok(assignment.rows[0].accepted_at !== null);

    // Verify trigger trg_sync_crew_fee automatically injected line item into project_expenses
    const expenses = await db.query<{ category: string; name: string; total_cost: string | number }>(
      "select category, name, total_cost from public.project_expenses where project_id = $1",
      [projectId]
    );
    assert.equal(expenses.rows.length, 1);
    assert.equal(expenses.rows[0].category, "CREW_FEE");
    assert.equal(Number(expenses.rows[0].total_cost), 500000);
    assert.ok(expenses.rows[0].name.includes("FOH Technical Director"));

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 3: DECLINING OFFER (respond_crew_assignment_offer -> false)
  // =========================================================================
  await t.test("Offer Decline: worker declines offer -> transitions to DECLINED -> keeps expenses clean", async () => {
    await db.exec("set role service_role;");

    const azrianId = "f0000000-0000-0000-0000-000000000004";

    // Offer sent to Azrian with offered fee Rp 350.000
    await db.exec(`
      insert into public.project_crew_assignments (
        project_id, crew_member_id, magic_token, role_title, call_time,
        venue_name, venue_address, fee_agreed, acceptance_status
      ) values (
        '${projectId}', '${azrianId}', '${tokenDeclined}',
        'Camera 2 Wireless Roving', '2026-10-05T07:00:00+07:00',
        'Gor Satria Purwokerto', 'Jl. Prof. Dr. Suharso', 350000,
        'PENDING_OFFER'
      );
    `);

    // Worker invokes respond_crew_assignment_offer with accept: false
    const res = await db.query<{ respond_crew_assignment_offer: { success: boolean; status: string } }>(
      "select public.respond_crew_assignment_offer($1, false, 'Bentrok dengan jadwal konser lain')",
      [tokenDeclined]
    );

    assert.equal(res.rows[0].respond_crew_assignment_offer.success, true);
    assert.equal(res.rows[0].respond_crew_assignment_offer.status, "DECLINED");

    // Verify assignment row has declined_reason
    const assignment = await db.query<{ acceptance_status: string; declined_reason: string }>(
      "select acceptance_status, declined_reason from public.project_crew_assignments where magic_token = $1",
      [tokenDeclined]
    );
    assert.equal(assignment.rows[0].acceptance_status, "DECLINED");
    assert.equal(assignment.rows[0].declined_reason, "Bentrok dengan jadwal konser lain");

    // Verify project_expenses still ONLY contains Ray's expense (Azrian's fee was NOT injected)
    const expenses = await db.query<{ count: string | number }>(
      "select count(*) as count from public.project_expenses where project_id = $1",
      [projectId]
    );
    assert.equal(Number(expenses.rows[0].count), 1);

    await db.exec("reset role;");
  });
});
