import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { calculateWaterfallSplit } from "../src/lib/finance/waterfall";

test("3 Core Pillars Integration: Moodboard, Waterfall Finance & Calendar Booking", async (t) => {
  const db = new PGlite();
  const customerId = "a0000000-0000-0000-0000-000000000001";
  const projectId = "b0000000-0000-0000-0000-000000000001";

  // 1. Initialize DB with all 7 migrations
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

  // 2. Base project and customer fixture
  await db.exec(`
    set role service_role;
    insert into public.customers (id, name, phone)
    values ('${customerId}', 'Wisuda Client', '081234567890');

    insert into public.projects (
      id, customer_id, name, slug, photography_type,
      gallery_code, gallery_pin_hash, access_token, status
    ) values (
      '${projectId}', '${customerId}', 'Graduation Shoot',
      'grad-shoot-2026', 'graduation', 'ELTS-TEST0001',
      'scrypt-v1$${"A".repeat(22)}$${"A".repeat(43)}', '${"y".repeat(43)}', 'ready'
    );
  `);

  // ==========================================
  // PILLAR 1: MOODBOARD & THREADED COMMENTS
  // ==========================================
  await t.test("Pillar 1: Moodboard cards, shot list toggle & comments", async () => {
    await db.exec("set role service_role;");

    // Add Color Swatch card
    const cardRes = await db.query<{ id: string }>(`
      insert into public.moodboard_cards (project_id, card_type, title, payload)
      values (
        '${projectId}',
        'COLOR_SWATCH',
        'Academic Regalia Palette',
        '{"paletteName": "UNSOED Yellow & Velvet", "swatches": [{"hex": "#FBBF24", "label": "Gold Satin"}, {"hex": "#1E1B4B", "label": "Midnight Blue"}]}'
      ) returning id;
    `);
    const cardId = cardRes.rows[0].id;
    assert.ok(cardId);

    // Add Shot list card
    const shotCardRes = await db.query<{ id: string }>(`
      insert into public.moodboard_cards (project_id, card_type, title, payload)
      values (
        '${projectId}',
        'SHOT_LIST',
        'Mandatory Ceremony Moments',
        '{"items": [{"text": "Pemberian Ijazah oleh Dekan", "checked": false}, {"text": "Lempar Toga Bersama Keluarga", "checked": true}]}'
      ) returning id;
    `);
    const shotCardId = shotCardRes.rows[0].id;
    assert.ok(shotCardId);

    // Post comment from client
    await db.exec(`
      insert into public.moodboard_comments (card_id, author_role, author_name, content)
      values ('${cardId}', 'CLIENT', 'Siti', 'Bisa ditambahkan lighting hangat untuk background emas?');
    `);

    // Post reply from studio director
    await db.exec(`
      insert into public.moodboard_comments (card_id, author_role, author_name, content)
      values ('${cardId}', 'STUDIO', 'Ray Lead', 'Tentu, kita bawa spotlight 3200K amber.');
    `);

    const comments = await db.query<{ author_role: string; content: string }>(
      "select author_role, content from public.moodboard_comments where card_id = $1 order by created_at",
      [cardId]
    );
    assert.equal(comments.rows.length, 2);
    assert.equal(comments.rows[0].author_role, "CLIENT");
    assert.equal(comments.rows[1].author_role, "STUDIO");

    await db.exec("reset role;");
  });

  // ==========================================
  // PILLAR 2: WATERFALL FINANCE & DUAL APPROVAL
  // ==========================================
  await t.test("Pillar 2: Waterfall split math & dual-approval RPC with ledger inflow", async () => {
    // 1. Verify waterfall calculation pure function
    const math = calculateWaterfallSplit({
      grossRevenue: 2000000,
      directCosts: 500000,
      reservePct: 5.0,
      commissionPct: 5.0,
      closerName: "Founder A (Ray)",
    });
    // Net profit = 2M - 500k = 1.5M
    assert.equal(math.netProfit, 1500000);
    // Reserve 5% of 1.5M = 75,000
    assert.equal(math.reserveAmount, 75000);
    // Commission 5% of 1.5M = 75,000
    assert.equal(math.commissionAmount, 75000);
    // Distributable = 1.5M - 75k - 75k = 1.35M
    // 50% each = 675,000
    assert.equal(math.founderAShare, 675000);
    assert.equal(math.founderBShare, 675000);

    await db.exec("set role service_role;");

    // Insert split into DB
    const splitRes = await db.query<{ id: string }>(`
      insert into public.money_splits (
        project_id, gross_revenue, direct_costs, net_profit,
        reserve_pct, reserve_amount, commission_pct, commission_amount,
        closer_name, founder_a_share, founder_b_share, status
      ) values (
        '${projectId}', ${math.grossRevenue}, ${math.directCosts}, ${math.netProfit},
        ${math.reservePct}, ${math.reserveAmount}, ${math.commissionPct}, ${math.commissionAmount},
        '${math.closerName}', ${math.founderAShare}, ${math.founderBShare}, 'PENDING_APPROVAL'
      ) returning id;
    `);
    const splitId = splitRes.rows[0].id;
    assert.ok(splitId);

    // Founder A approves
    const appA = await db.query<{ approve_money_split: { status: string; approved_by_a: boolean; approved_by_b: boolean } }>(
      "select public.approve_money_split($1, 'A')",
      [splitId]
    );
    // Status must remain PENDING_APPROVAL because Founder B has not approved yet
    assert.equal(appA.rows[0].approve_money_split.status, "PENDING_APPROVAL");
    assert.equal(appA.rows[0].approve_money_split.approved_by_a, true);
    assert.equal(appA.rows[0].approve_money_split.approved_by_b, false);

    // Ledger should NOT have reserve inflow yet
    const preLedger = await db.query<{ cnt: string | number }>("select count(*) as cnt from public.cash_ledger where project_id = $1", [projectId]);
    assert.equal(preLedger.rows[0].cnt, 0);

    // Founder B approves -> triggers APPROVED status and ledger inflow
    const appB = await db.query<{ approve_money_split: { status: string; approved_by_a: boolean; approved_by_b: boolean } }>(
      "select public.approve_money_split($1, 'B')",
      [splitId]
    );
    assert.equal(appB.rows[0].approve_money_split.status, "APPROVED");
    assert.equal(appB.rows[0].approve_money_split.approved_by_a, true);
    assert.equal(appB.rows[0].approve_money_split.approved_by_b, true);

    // Ledger should now have exactly 1 record for RESERVE_INFLOW
    const postLedger = await db.query<{ category: string; amount: number }>(
      "select category, amount from public.cash_ledger where project_id = $1",
      [projectId]
    );
    assert.equal(postLedger.rows.length, 1);
    assert.equal(postLedger.rows[0].category, "RESERVE_INFLOW");
    assert.equal(Number(postLedger.rows[0].amount), 75000);
    await db.exec("reset role;");
  });

  // ==========================================
  // PILLAR 3: CALENDAR & BOOKING
  // ==========================================
  await t.test("Pillar 3: Studio event scheduling & conflict queries", async () => {
    await db.exec("set role service_role;");

    // Book 15-min discovery call
    const start = "2026-09-25T09:00:00+07:00";
    const end = "2026-09-25T09:15:00+07:00";

    const eventRes = await db.query<{ id: string; meet_link: string }>(`
      insert into public.studio_events (
        title, event_type, client_name, client_phone, client_email,
        service_interest, start_time, end_time, meet_link, status
      ) values (
        'Discovery Call — Ahmad Wisuda', 'DISCOVERY_CALL', 'Ahmad Fauzi', '081987654321',
        'ahmad@example.com', 'Pictures Event/Graduation', '${start}', '${end}',
        'https://meet.google.com/elt-test-call', 'SCHEDULED'
      ) returning id, meet_link;
    `);

    assert.ok(eventRes.rows[0].id);
    assert.equal(eventRes.rows[0].meet_link, "https://meet.google.com/elt-test-call");

    // Query conflicting events for that time slot
    const conflicts = await db.query<{ count: string | number }>(`
      select count(*) as count from public.studio_events
      where status = 'SCHEDULED'
        and start_time < '${end}'
        and end_time > '${start}';
    `);
    assert.equal(conflicts.rows[0].count, 1);

    await db.exec("reset role;");
  });
});
