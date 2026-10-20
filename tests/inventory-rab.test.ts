import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Master Inventory & Granular RAB: Asset Catalog, Conflict RPC & Source Attribution", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const project1Id = "b0000000-0000-0000-0000-000000000001";
  const project2Id = "b0000000-0000-0000-0000-000000000002";

  // 1. Initialize DB with all 7 migrations (including 0006)
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

  // 2. Base fixtures: Customer & 2 Projects on same shoot date (2026-09-28)
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone)
    values ('${customerId}', 'PT Live Production', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type, service_pillar,
      gallery_code, gallery_pin_hash, access_token, shoot_date, status
    ) values 
      ('${project1Id}', '${customerId}', 'Konser Musik Banyumas Live',
       'konser-musik-banyumas', 'event', 'BROADCAST_LIVE_STREAMING',
       'ELTS-KONSER01', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"1".repeat(43)}',
       '2026-09-28', 'ready'),
      ('${project2Id}', '${customerId}', 'Seminar Nasional Rektorat',
       'seminar-nasional-unsoed', 'event', 'BROADCAST_LIVE_STREAMING',
       'ELTS-SEMNAS01', 'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"2".repeat(43)}',
       '2026-09-28', 'ready');
    reset role;
  `);

  // =========================================================================
  // TEST 1: PRE-SEEDED INVENTORY ASSETS BY SOURCE TYPE
  // =========================================================================
  await t.test("Inventory Catalog: Pre-seeded assets with Studio, Partner, and Vendor sources", async () => {
    await db.exec("set role service_role;");

    const assets = await db.query<{ asset_code: string; name: string; source_type: string; owner_name: string; vendor_name: string | null }>(
      "select asset_code, name, source_type, owner_name, vendor_name from public.inventory_assets order by asset_code"
    );

    assert.ok(assets.rows.length >= 13, "Should have at least 13 pre-seeded assets");

    // In-House Studio Asset (Sony FX3)
    const fx3 = assets.rows.find((a) => a.asset_code === "AST-CAM-01");
    assert.ok(fx3);
    assert.equal(fx3.source_type, "IN_HOUSE");
    assert.equal(fx3.owner_name, "Studio");

    // Partner-Owned Asset (Sony ZV-E10 milik El)
    const zve10 = assets.rows.find((a) => a.asset_code === "AST-CAM-03");
    assert.ok(zve10);
    assert.equal(zve10.source_type, "PARTNER_OWNED");
    assert.equal(zve10.owner_name, "El");

    // Vendor Rental Asset (Sony HXR-NX200 dari Koi Rental)
    const nx200 = assets.rows.find((a) => a.asset_code === "AST-CAM-05");
    assert.ok(nx200);
    assert.equal(nx200.source_type, "VENDOR_RENTAL");
    assert.equal(nx200.vendor_name, "Koi Rental Purwokerto");

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 2: SCHEDULING COLLISION DETECTOR RPC
  // =========================================================================
  await t.test("Collision Detection: check_asset_scheduling_conflict flags double-booked assets", async () => {
    await db.exec("set role service_role;");

    // Get Sony FX3 ID
    const fx3 = await db.query<{ id: string }>(
      "select id from public.inventory_assets where asset_code = 'AST-CAM-01'"
    );
    const fx3Id = fx3.rows[0].id;

    // Project 1 books Sony FX3 for 2026-09-28
    await db.exec(`
      insert into public.project_expenses (
        project_id, category, name, unit_cost, quantity, asset_id, source_type, owner_name
      ) values (
        '${project1Id}', 'EQUIPMENT_RENTAL', 'Sony FX3 Cinema Line Body', 450000, 1, '${fx3Id}', 'IN_HOUSE', 'Studio'
      );
    `);

    // Check collision for Project 2 attempting to book the SAME Sony FX3 on the SAME date (2026-09-28)
    const conflictCheck = await db.query<{ conflict_found: boolean; conflicting_project_id: string; conflicting_project_name: string }>(
      "select * from public.check_asset_scheduling_conflict($1, $2, $3)",
      [fx3Id, project2Id, "2026-09-28"]
    );

    assert.equal(conflictCheck.rows.length, 1);
    assert.equal(conflictCheck.rows[0].conflict_found, true);
    assert.equal(conflictCheck.rows[0].conflicting_project_id, project1Id);
    assert.equal(conflictCheck.rows[0].conflicting_project_name, "Konser Musik Banyumas Live");

    // Check for a DIFFERENT non-conflicting date (e.g. 2026-09-30)
    const noConflictCheck = await db.query<{ conflict_found: boolean }>(
      "select * from public.check_asset_scheduling_conflict($1, $2, $3)",
      [fx3Id, project2Id, "2026-09-30"]
    );
    assert.equal(noConflictCheck.rows.length, 0);

    await db.exec("reset role;");
  });

  // =========================================================================
  // TEST 3: VENDOR EXPENSE ATTRIBUTION & RETURN STATUS
  // =========================================================================
  await t.test("Vendor Expense Tracking: logs vendor name, duration, and return status", async () => {
    await db.exec("set role service_role;");

    // Insert external rental expense for Koi Rental
    await db.exec(`
      insert into public.project_expenses (
        project_id, category, name, unit_cost, quantity, source_type,
        vendor_name, vendor_phone, rental_duration_days, return_date, return_status
      ) values (
        '${project1Id}', 'EQUIPMENT_RENTAL', 'Sony HXR-NX200 Camcorder 4K', 400000, 1, 'VENDOR_RENTAL',
        'Koi Rental Purwokerto', '081327889900', 1, '2026-09-29', 'PENDING'
      );
    `);

    const vendorExpenses = await db.query<{ vendor_name: string; return_status: string; total_cost: string | number }>(
      "select vendor_name, return_status, total_cost from public.project_expenses where project_id = $1 and source_type = 'VENDOR_RENTAL'",
      [project1Id]
    );

    assert.equal(vendorExpenses.rows.length, 1);
    assert.equal(vendorExpenses.rows[0].vendor_name, "Koi Rental Purwokerto");
    assert.equal(vendorExpenses.rows[0].return_status, "PENDING");
    assert.equal(Number(vendorExpenses.rows[0].total_cost), 400000);

    await db.exec("reset role;");
  });
});
