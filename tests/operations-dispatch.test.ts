import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomBytes } from "node:crypto";

test("Operations Dispatch: Zero-Leakage RPC, Auto-Expense Trigger & Calendar", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";
  const crewMemberA = "c1000000-0000-0000-0000-000000000001";
  const crewMemberB = "c1000000-0000-0000-0000-000000000002";
  const magicTokenA = randomBytes(32).toString("base64url");
  const magicTokenB = randomBytes(32).toString("base64url");

  // 1. Initialize DB with all migrations (including 0005)
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

  // 2. Base customer and project fixture with confidential contract_value
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone)
    values ('${customerId}', 'PT Broadcast Client', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status,
      contract_value, dp_amount, is_dp_paid, is_fully_paid
    ) values (
      '${projectId}', '${customerId}', 'Konser Musik Banyumas Live Broadcast',
      'konser-musik-banyumas', 'event', 'BROADCAST_LIVE_STREAMING',
      'ELTS-KONSER01', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"k".repeat(43)}',
      '2026-09-28', 'ready', 15000000, 7500000, true, false
    );

    /* 0024 moved contact/bank out of crew_members. These fixtures have no
       login, so their details live in crew_contact_details. */
    insert into public.crew_members (id, crew_code, full_name, primary_skills, standard_day_rate)
    values
      ('${crewMemberA}', 'CRW-01', 'Fajar Switcher', array['Switcher Operator', 'vMix'], 500000),
      ('${crewMemberB}', 'CRW-02', 'Dimas Roving', array['Cameraman', 'Wireless'], 400000);

    insert into public.crew_contact_details (crew_member_id, phone, bank_name, bank_account_number, bank_account_holder)
    values
      ('${crewMemberA}', '081234567001', 'BCA', '0000000000', 'Fajar Switcher'),
      ('${crewMemberB}', '081234567002', 'Mandiri', '13700192837', 'Dimas Roving');
    reset role;
  `);

  // =========================================================================
  // TEST 1: AUTO-EXPENSE TRIGGER ON CREW ASSIGNMENT INSERT & UPDATE
  // =========================================================================
  await t.test("Auto-Expense Trigger: assigning crew automatically syncs row into public.project_expenses", async () => {
    await db.exec("set role service_role;");

    // Assign Crew Member A with agreed fee Rp 450.000
    const assignRes = await db.query<{ id: string }>(`
      insert into public.project_crew_assignments (
        project_id, crew_member_id, magic_token, role_title, call_time,
        venue_name, venue_address, fee_agreed, allocated_equipment, acceptance_status
      ) values (
        '${projectId}', '${crewMemberA}', '${magicTokenA}',
        'Switcher Lead vMix', '2026-09-28T07:00:00+07:00',
        'Gor Satria Purwokerto', 'Jl. Prof. Dr. Suharso', 450000,
        array['vMix Rig 4K', 'Intercom 4-St'], 'ACCEPTED'
      ) returning id;
    `);
    const assignmentId = assignRes.rows[0].id;
    assert.ok(assignmentId);

    // Verify trigger trg_sync_crew_fee automatically created an expense item
    const expenses = await db.query<{ category: string; name: string; unit_cost: string | number; total_cost: string | number; crew_assignment_id: string }>(
      "select category, name, unit_cost, total_cost, crew_assignment_id from public.project_expenses where project_id = $1",
      [projectId]
    );
    assert.equal(expenses.rows.length, 1);
    assert.equal(expenses.rows[0].category, "CREW_FEE");
    assert.equal(Number(expenses.rows[0].total_cost), 450000);
    assert.equal(expenses.rows[0].crew_assignment_id, assignmentId);
    assert.ok(expenses.rows[0].name.includes("Fajar Switcher"));

    // Update fee_agreed to Rp 500.000 -> trigger updates expense item
    await db.exec(`
      update public.project_crew_assignments
      set fee_agreed = 500000
      where id = '${assignmentId}';
    `);

    const updatedExpenses = await db.query<{ total_cost: string | number }>(
      "select total_cost from public.project_expenses where crew_assignment_id = $1",
      [assignmentId]
    );
    assert.equal(Number(updatedExpenses.rows[0].total_cost), 500000);

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 2: STRICT ZERO-LEAKAGE INVARIANT ON CREW HUB RPC
  // =========================================================================
  await t.test("Zero-Leakage Invariant: get_crew_hub_payload returns operational details but zero financial leakage", async () => {
    await db.exec("set role service_role;");

    // Assign Crew Member B with agreed fee Rp 400.000
    await db.exec(`
      insert into public.project_crew_assignments (
        project_id, crew_member_id, magic_token, role_title, call_time,
        venue_name, venue_address, fee_agreed, allocated_equipment, acceptance_status
      ) values (
        '${projectId}', '${crewMemberB}', '${magicTokenB}',
        'Camera 2 Wireless Roving', '2026-09-28T07:30:00+07:00',
        'Gor Satria Purwokerto', 'Jl. Prof. Dr. Suharso', 400000,
        array['Sony FX3 Body', 'Hollyland Cosmo C1'], 'ACCEPTED'
      );
    `);

    // Call get_crew_hub_payload for Crew Member B
    const res = await db.query<{ get_crew_hub_payload: Record<string, unknown> }>(
      "select public.get_crew_hub_payload($1)",
      [magicTokenB]
    );

    const payload = res.rows[0].get_crew_hub_payload;
    assert.ok(payload);

    // 1. Assert operational payload exists
    assert.equal(payload.role_title, "Camera 2 Wireless Roving");
    assert.equal(payload.venue_name, "Gor Satria Purwokerto");
    assert.equal(payload.fee_agreed, 400000); // Crew can see their own agreed fee
    assert.deepEqual(payload.allocated_equipment, ["Sony FX3 Body", "Hollyland Cosmo C1"]);

    // 2. Strict Zero-Leakage Invariants:
    // MUST NOT leak client contract value (Rp 15.000.000)
    assert.equal(payload.contract_value, undefined);
    assert.equal((payload.project as Record<string, unknown>).contract_value, undefined);

    // MUST NOT leak studio gross/net profit or other crew member fees
    assert.equal(payload.profit, undefined);
    assert.equal(payload.net_profit, undefined);
    assert.equal(payload.gross_revenue, undefined);
    assert.equal(payload.all_crew, undefined);
    assert.equal(payload.other_crew, undefined);

    // Invoking with non-existent token returns clean error object
    const invalidRes = await db.query<{ get_crew_hub_payload: { error?: string } }>(
      "select public.get_crew_hub_payload('invalid-token-12345678901234567890')"
    );
    assert.equal(invalidRes.rows[0].get_crew_hub_payload.error, "INVALID_TOKEN");

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 3: EQUIPMENT PRESET TO EXPENSE WORKSHEET
  // =========================================================================
  await t.test("Equipment Presets & Direct Costs aggregation", async () => {
    await db.exec("set role service_role;");

    // Fetch an equipment preset (e.g. Sony FX3)
    const preset = await db.query<{ id: string; name: string; default_rental_rate: string | number }>(
      "select id, name, default_rental_rate from public.equipment_presets where name like 'Sony FX3%' limit 1"
    );
    assert.ok(preset.rows[0]);

    // Insert as equipment rental expense
    await db.exec(`
      insert into public.project_expenses (
        project_id, category, name, unit_cost, quantity, equipment_preset_id, paid_by
      ) values (
        '${projectId}', 'EQUIPMENT_RENTAL', '${preset.rows[0].name}',
        ${preset.rows[0].default_rental_rate}, 2, '${preset.rows[0].id}', 'STUDIO_CASH'
      );
    `);

    // Verify total direct costs aggregated
    const totalExp = await db.query<{ total_direct: string | number }>(
      "select sum(total_cost) as total_direct from public.project_expenses where project_id = $1",
      [projectId]
    );
    // Crew A (500k) + Crew B (400k) + 2x FX3 (2 * 450k = 900k) = 1.800.000
    assert.equal(Number(totalExp.rows[0].total_direct), 1800000);

    await db.exec("reset role;");
  });
});
