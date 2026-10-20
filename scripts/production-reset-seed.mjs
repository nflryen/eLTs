#!/usr/bin/env node
/**
 * Production scrub + controlled single-sector seed.
 *
 * WHAT THIS DOES
 * --------------
 *   1. Truncates every operational transaction table, preserving the schema,
 *      triggers, `roles`, `permissions`, `role_permissions`, and
 *      `document_sequences` (document numbering must not restart — see
 *      `docs/rfc-multi-role-and-production-readiness.md` §7.4).
 *   2. Purges previous test accounts from `auth.users` and their profiles.
 *   3. Provisions exactly the five real team identities with their hybrid role
 *      mappings and an explicit base role.
 *   4. Seeds exactly one baseline record per operational sector.
 *   5. Allocates 5,000 bp to El and 5,000 bp to Cahyo.
 *
 * SAFETY
 * ------
 *   - Refuses to run without `--yes`.
 *   - Runs the destructive section inside ONE transaction; any failure rolls
 *     back everything, including the auth deletions.
 *   - Prints the pre-flight row counts before touching anything.
 *   - Never uses `TRUNCATE ... CASCADE`: the FK graph reaches `roles`, so a
 *     mistyped table would silently wipe the role catalogue.
 *
 * USAGE
 *   set -a && . ./.env.local && set +a
 *   node scripts/production-reset-seed.mjs            # dry run (default)
 *   node scripts/production-reset-seed.mjs --yes      # execute
 */

import { Client } from "pg";
import { randomBytes, scryptSync } from "node:crypto";
import process from "node:process";

const EXECUTE = process.argv.includes("--yes");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set. Source .env.local first.");
  process.exit(1);
}

/* ── The five real identities ────────────────────────────────────────────────
 * `roles[0]` is the BASE role: what the account resolves to on login before any
 * elevation. The brief specifies WORKER as the base for hybrid accounts.
 */
const TEAM = [
  {
    email: "gendeng@elts.id",
    password: "Gendeng#[REDACTED_SEED_SECRET]",
    fullName: "Gendeng Gila Sugih",
    displayName: "Gendeng",
    roles: ["SUPER_ADMIN"],
    title: "Super Admin",
  },
  {
    email: "el@elts.id",
    password: "El#[REDACTED_SEED_SECRET]",
    fullName: "El",
    displayName: "El",
    roles: ["FOUNDER"],
    title: "Leader",
  },
  {
    email: "wardah@elts.id",
    password: "Wardah#[REDACTED_SEED_SECRET]",
    fullName: "Wardah",
    displayName: "Wardah",
    roles: ["ADMIN"],
    title: "Admin",
  },
  {
    email: "cahyo@elts.id",
    password: "Cahyo#[REDACTED_SEED_SECRET]",
    fullName: "Cahyo",
    displayName: "Cahyo",
    // Hybrid: base WORKER, can elevate to FOUNDER with a password challenge.
    roles: ["WORKER", "FOUNDER"],
    title: "Worker / Founder",
  },
  {
    email: "ray@elts.id",
    password: "Ray#[REDACTED_SEED_SECRET]",
    fullName: "Ray",
    displayName: "Ray",
    // Hybrid: base WORKER, can drop to EDITOR or elevate to FOUNDER.
    roles: ["WORKER", "EDITOR", "FOUNDER"],
    title: "Worker / Editor / Founder",
  },
];

/* Base role for each hybrid account, per the brief. */
const BASE_ROLE = {
  "cahyo@elts.id": "WORKER",
  "ray@elts.id": "WORKER",
};

/* Operational tables, leaves first. Derived from the live FK graph. */
const TRUNCATE_ORDER = [
  // Level 0 — private-schema child of projects. It is NOT in `public`, so it was
  // invisible to the information_schema scan that produced this list, and its
  // presence is why a naive truncate fails with "referenced in a foreign key
  // constraint" naming a table that does not appear anywhere in the brief.
  "private.gallery_sessions",
  // Level 1 — no dependants
  "moodboard_comments",
  "favorites",
  "invoice_payment_receipts",
  "compensation_line_items",
  "payslip_records",
  "payroll_audit_log",
  "client_reminders_log",
  "vendor_purchase_order_items",
  "outgoing_rental_items",
  // Level 2 — parents of level 1
  "payroll_cycles",
  "project_profit_snapshots",
  "project_invoices",
  "vendor_purchase_orders",
  "outgoing_rental_orders",
  "money_splits",
  "cash_ledger",
  "project_expenses",
  "editor_tasks",
  "project_crew_assignments",
  "moodboard_cards",
  "portfolio_showcases",
  "media",
  "inquiries",
  "studio_events",
  // Level 3 — projects, then customers
  "projects",
  "customers",
  // Level 4 — operational catalogue (not identity)
  "inventory_assets",
  "equipment_presets",
  "compensation_rates",
];

/** Mirrors `hashGalleryPin` so seeded projects have a usable gallery PIN. */
function hashPin(pin) {
  /*
   * MUST match src/lib/security/credentials.ts byte for byte:
   *   - 16-byte salt, base64url, 22 chars
   *   - 32-byte key, base64url, 43 chars
   *   - maxmem is REQUIRED: OpenSSL's default scrypt memory limit rejects
   *     N=32768,r=8,p=3 with "memory limit exceeded". The application sets it
   *     to 64 MiB, so this must too or the seeded PIN can never verify.
   */
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(pin, salt, 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt-v2$${salt}$${derived.toString("base64url")}`;
}

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();

  console.log("ELTS production reset + seed");
  console.log("=".repeat(64));
  console.log(`Mode: ${EXECUTE ? "EXECUTE" : "DRY RUN (pass --yes to apply)"}`);

  /* ── Pre-flight ───────────────────────────────────────────────────────── */
  const db = await client.query(
    "select current_database() db, coalesce(inet_server_addr()::text,'local') host",
  );
  console.log(`Target: ${db.rows[0].db} @ ${db.rows[0].host}`);

  const counts = {};
  for (const t of TRUNCATE_ORDER) {
    const qualified = t.includes(".") ? t : `public.${t}`;
    const r = await client.query(`select count(*)::int c from ${qualified}`);
    counts[t] = r.rows[0].c;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`Operational rows to delete: ${total}`);
  for (const [t, c] of Object.entries(counts)) {
    if (c > 0) console.log(`  ${t.padEnd(32)} ${c}`);
  }

  const seq = await client.query(
    "select doc_type, period_key, last_value from public.document_sequences order by doc_type, period_key",
  );
  console.log("document_sequences PRESERVED:");
  for (const r of seq.rows) {
    console.log(`  ${r.doc_type}/${r.period_key} -> ${r.last_value}`);
  }

  const users = await client.query(
    "select id, email from auth.users order by created_at",
  );
  console.log(`Existing auth.users: ${users.rowCount}`);
  for (const u of users.rows) console.log(`  ${u.email}`);

  if (!EXECUTE) {
    console.log("\nDry run complete. Nothing was written.");
    return;
  }

  /* ── Destructive section — one transaction ────────────────────────────── */
  await client.query("begin");

  try {
    /*
     * TRUNCATE, not DELETE: `payroll_audit_log` has a BEFORE DELETE trigger
     * that raises, so DELETE would fail. TRUNCATE is row-trigger-free but still
     * blocked by FKs unless the whole set is named in one statement, which is
     * exactly why every table is listed explicitly rather than using CASCADE.
     */
    await client.query(
      `truncate table ${TRUNCATE_ORDER.map((t) =>
        t.includes(".") ? t : `public.${t}`,
      ).join(", ")}
       restart identity`,
    );
    console.log(`✓ truncated ${TRUNCATE_ORDER.length} operational tables`);

    /* Purge previous test accounts. Cascades to profiles and assignments. */
    const keepEmails = TEAM.map((t) => t.email.toLowerCase());
    const del = await client.query(
      `delete from auth.users
        where lower(email) <> all($1::text[])
        returning email`,
      [keepEmails],
    );
    console.log(`✓ purged ${del.rowCount} previous account(s)`);

    /* ── Provision identities ───────────────────────────────────────────── */
    const userIds = {};
    for (const member of TEAM) {
      /*
       * Written directly to auth.users because this script has no service-role
       * key. The identity row and the password hash are produced the way GoTrue
       * stores them: bcrypt via crypt() is not available, so we insert the
       * email identity and let the operator set the password through the
       * Supabase dashboard OR the seed password below is applied via
       * `auth.users.encrypted_password` using pgcrypto's bcrypt.
       */
      const existing = await client.query(
        "select id from auth.users where lower(email) = lower($1)",
        [member.email],
      );

      let uid;
      if (existing.rowCount > 0) {
        uid = existing.rows[0].id;
        await client.query(
          `update auth.users
              set encrypted_password = crypt($2, gen_salt('bf')),
                  email_confirmed_at = coalesce(email_confirmed_at, now()),
                  updated_at = now()
            where id = $1`,
          [uid, member.password],
        );
      } else {
        const ins = await client.query(
          `insert into auth.users
             (instance_id, id, aud, role, email, encrypted_password,
              email_confirmed_at, created_at, updated_at,
              raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
           values
             ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
              'authenticated', 'authenticated', $1,
              crypt($2, gen_salt('bf')), now(), now(), now(),
              '{"provider":"email","providers":["email"]}'::jsonb,
              jsonb_build_object('full_name', $3::text),
              false, false)
           returning id`,
          [member.email, member.password, member.fullName],
        );
        uid = ins.rows[0].id;
      }

      /* GoTrue requires a matching identities row for password login. */
      await client.query(
        `insert into auth.identities
           (id, user_id, provider_id, identity_data, provider,
            last_sign_in_at, created_at, updated_at)
         values
           (gen_random_uuid(), $1::uuid, $1::text,
            jsonb_build_object('sub', $1::text, 'email', $2::text),
            'email', now(), now(), now())
         on conflict (provider_id, provider) do nothing`,
        [uid, member.email],
      );

      userIds[member.email] = uid;

      /* Profile — the single canonical identity record. */
      await client.query(
        `insert into public.user_profiles (user_id, full_name, display_name)
         values ($1, $2, $3)
         on conflict (user_id) do update
           set full_name = excluded.full_name,
               display_name = excluded.display_name,
               updated_at = now()`,
        [uid, member.fullName, member.displayName],
      );

      /* Staff marker + role assignments. */
      await client.query(
        `insert into public.admins (user_id, display_name) values ($1, $2)
         on conflict (user_id) do update set display_name = excluded.display_name`,
        [uid, member.displayName],
      );

      await client.query(
        "delete from public.role_assignments where user_id = $1",
        [uid],
      );

      const base = BASE_ROLE[member.email] ?? member.roles[0];
      for (const role of member.roles) {
        await client.query(
          `insert into public.role_assignments
             (user_id, role_key, granted_by, is_default)
           values ($1, $2, null, $3)`,
          [uid, role, role === base],
        );
      }

      /* Crew record so the member is assignable to call sheets. */
      const crewCode = `CRW-${member.fullName.split(" ")[0].toUpperCase().slice(0, 6)}`;
      await client.query(
        `insert into public.crew_members
           (crew_code, full_name, phone, email, primary_skills,
            bank_name, bank_account_number, bank_account_holder,
            standard_day_rate, role_category, member_type, jobdesk_specialties,
            auth_user_id)
         values ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11,$12::text[],$13)
         on conflict (auth_user_id) where auth_user_id is not null do update
           set crew_code = excluded.crew_code,
               full_name = excluded.full_name,
               email = excluded.email`,
        [
          crewCode,
          member.fullName,
          "+62 812 0000 0000",
          member.email,
          member.roles.includes("EDITOR")
            ? "{Editing,Retouching}"
            : "{Production}",
          "BCA",
          "0000000000",
          member.fullName,
          0,
          member.roles.includes("EDITOR") ? "EDITOR" : "DIRECTOR",
          "CORE_TEAM",
          `{${member.title.replace(/\//g, ",").replace(/,\s*/g, ",")}}`,
          uid,
        ],
      );

      console.log(`✓ ${member.email.padEnd(22)} [${member.roles.join(", ")}] base=${base}`);
    }

    /* ── Equity: 5,000 + 5,000 = 10,000 bp ──────────────────────────────── */
    await client.query("delete from public.partner_accounts");
    await client.query(
      `insert into public.partner_accounts (user_id, display_name, equity_bp, is_active)
       values ($1, 'El', 5000, true), ($2, 'Cahyo', 5000, true)`,
      [userIds["el@elts.id"], userIds["cahyo@elts.id"]],
    );
    console.log("✓ equity: El 5000 bp + Cahyo 5000 bp = 10000 bp");

    /* ── Baseline: ONE record per sector ─────────────────────────────────── */
    const cust = await client.query(
      `insert into public.customers (name, email, phone)
       values ('Baseline Client — Studio Verification', 'baseline@elts.id', '+62 812 0000 0001')
       returning id`,
    );
    const customerId = cust.rows[0].id;

    const proj = await client.query(
      `insert into public.projects
         (customer_id, name, slug, photography_type, gallery_code,
          gallery_pin_hash, access_token, shoot_date, status, expires_at)
       values ($1, 'Baseline Editorial Session', 'baseline-editorial-session',
               'event', 'ELTS-BASE0001', $2, $3, current_date + 14, 'draft',
               now() + interval '30 days')
       returning id`,
      [customerId, hashPin("482913"), randomBytes(32).toString("base64url")],
    );
    const projectId = proj.rows[0].id;
    console.log(`✓ project   ${projectId}`);

    /* Invoice — numbered through the existing sequence RPC. */
    const invNo = await client.query(
      "select public.next_document_number('INV', to_char(now(), 'YYYY-MM')) n",
    );
    await client.query(
      `insert into public.project_invoices
         (project_id, invoice_number, issue_date, due_date, line_items,
          gross_contract_value, minimum_dp_pct)
       values ($1, $2, current_date, current_date + 14,
               $3::jsonb, 15000000, 50)`,
      [
        projectId,
        invNo.rows[0].n,
        JSON.stringify([
          { description: "Baseline editorial coverage", quantity: 1, unit_price: 15000000 },
        ]),
      ],
    );
    console.log(`✓ invoice   ${invNo.rows[0].n}`);

    /* Inventory — one primary camera rig. */
    const asset = await client.query(
      `insert into public.inventory_assets
         (asset_code, name, category, source_type, owner_name,
          daily_rental_rate, replacement_value, condition_status,
          is_available_for_outgoing_rental, serial_number, notes)
       values ('AST-CAM-01', 'Sony FX3 Primary Rig', 'CAMERA', 'IN_HOUSE',
               'ELTS Studio', 750000, 45000000, 'EXCELLENT', true,
               'FX3-BASELINE-0001', 'Baseline verification rig')
       returning id`,
    );
    console.log(`✓ asset     ${asset.rows[0].id}`);

    /* Crew assignment — one call-sheet duty. */
    const crew = await client.query(
      "select id from public.crew_members where auth_user_id = $1",
      [userIds["ray@elts.id"]],
    );
    await client.query(
      `insert into public.project_crew_assignments
         (project_id, crew_member_id, magic_token, role_title, call_time,
          venue_name, venue_address, dress_code, allocated_equipment,
          fee_agreed, payment_status, acceptance_status)
       values ($1, $2, $3, 'Lead Photographer', now() + interval '14 days',
               'Studio Baseline', 'Jl. Baseline No. 1, Jakarta',
               'Black Studio Polo', '{}', 1500000, 'UNPAID', 'PENDING_OFFER')`,
      [projectId, crew.rows[0].id, randomBytes(32).toString("base64url")],
    );
    console.log("✓ crew assignment");

    /* Payroll — one draft compensation item. */
    await client.query(
      `insert into public.compensation_line_items
         (payee_user_id, kind, project_id, source_table, source_id,
          role_label, gross_amount, deduction_amount, earned_on, state)
       values ($1, 'EDITOR_RATE', $2, 'editor_tasks', gen_random_uuid(),
               'Baseline editing verification', 350000, 0, current_date,
               'PENDING_VERIFICATION')`,
      [userIds["ray@elts.id"], projectId],
    );
    console.log("✓ payroll draft item");

    await client.query("commit");
    console.log("\n✓ committed");
  } catch (err) {
    await client.query("rollback");
    console.error("\n✗ FAILED — rolled back:", err.message);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error("fatal:", e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
