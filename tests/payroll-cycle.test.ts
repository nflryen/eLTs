import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/**
 * Payroll cycle lifecycle against real PostgreSQL.
 *
 * Runs the actual migrations, then exercises the three RPCs the UI drives:
 *   generate_payroll_cycle / lock_payroll_cycle / disburse_payroll_cycle
 *
 * The three behaviours asserted here are the ones that would cost money if they
 * regressed:
 *   1. Generating twice for one period must not duplicate payslips.
 *   2. An ADMIN-ranked caller must not be able to disburse.
 *   3. Disbursing must mark every constituent line item PAID exactly once.
 */

const ADMIN_UID = "00000000-0000-0000-0000-0000000000a1";
const FOUNDER_UID = "00000000-0000-0000-0000-0000000000f1";
const CUSTOMER_ID = "00000000-0000-0000-0000-0000000000c1";
const PROJECT_ID = "10000000-0000-0000-0000-000000000001";
const CREW_A = "f0000000-0000-0000-0000-00000000000a";
const CREW_B = "f0000000-0000-0000-0000-00000000000b";

async function bootstrap() {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create table auth.sessions(id uuid primary key, user_id uuid not null, created_at timestamptz not null default now(), updated_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
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

  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await db.exec(await readFile(new URL(f, dir), "utf8"));
  }

  // Minimal fixture: two staff identities, one project, two crew members.
  await db.query(`insert into auth.users (id, email) values ($1,$2), ($3,$4)`, [
    ADMIN_UID, "admin@test.local", FOUNDER_UID, "founder@test.local",
  ]);
  await db.query(`insert into public.admins (user_id, display_name) values ($1,'Admin'), ($2,'Founder')`, [
    ADMIN_UID, FOUNDER_UID,
  ]);
  await db.query(`insert into public.role_assignments (user_id, role_key) values ($1,'ADMIN'), ($2,'FOUNDER')`, [
    ADMIN_UID, FOUNDER_UID,
  ]);
  await db.query(`insert into public.customers (id, name) values ($1,'Test Client')`, [CUSTOMER_ID]);
  await db.query(
    `insert into public.projects
       (id, customer_id, name, slug, photography_type, status,
        gallery_code, gallery_pin_hash, access_token)
     values ($1,$2,'Payroll Fixture','payroll-fixture','wedding','draft',
             'ELTS-PAYFEAT1','scrypt-v2$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')`,
    [PROJECT_ID, CUSTOMER_ID],
  );

  for (const [id, code, name, acct] of [
    [CREW_A, "CRW-AA", "Alpha Crew", "111"],
    [CREW_B, "CRW-BB", "Beta Crew", "222"],
  ]) {
    /* 0024: identity lives in crew_contact_details for crew without a login. */
    await db.query(
      `insert into public.crew_members (id, crew_code, full_name) values ($1,$2,$3)`,
      [id, code, name],
    );
    await db.query(
      `insert into public.crew_contact_details (crew_member_id, phone, bank_name, bank_account_number, bank_account_holder)
       values ($1,'081234567890','BCA',$2,$3)`,
      [id, acct, name],
    );
  }

  return db;
}

/** Inserts an APPROVED line item inside the 2026-10 period. */
type Db = Awaited<ReturnType<typeof bootstrap>>;

async function addLine(
  db: Db,
  crewId: string,
  amount: number,
  earnedOn = "2026-10-10",
  kind = "CREW_FEE",
): Promise<void> {
  await db.query(
    `insert into public.compensation_line_items
       (payee_crew_id, kind, project_id, source_table, source_id, role_label,
        gross_amount, earned_on, state)
     values ($1,$2,$3,'test',$4,'Crew',$5,$6,'APPROVED')`,
    [crewId, kind, PROJECT_ID, crypto.randomUUID(), amount, earnedOn],
  );
}

/** Shape common to the three payroll RPCs' JSONB returns. */
type RpcResult = {
  success: boolean;
  error?: string;
  message?: string;
  cycle_id?: string;
  slips_created?: number;
  lines_settled?: number;
  total_disbursement?: number;
  reused_cycle?: boolean;
  slips?: number;
  status?: string;
};

const rpc = async (
  db: Db,
  fn: string,
  params: Record<string, string | number | boolean>,
): Promise<RpcResult> => {
  const keys = Object.keys(params);
  const args = keys.map((_, i) => `$${i + 1}`).join(", ");
  const res = await db.query<{ r: RpcResult }>(
    `select public.${fn}(${args}) as r`,
    keys.map((k) => params[k]),
  );
  return res.rows[0].r;
};

test("generate is idempotent: a second run for the same period creates no slips", async (t) => {
  const db = await bootstrap();
  t.after(async () => db.close());

  await addLine(db, CREW_A, 500_000);
  await addLine(db, CREW_B, 350_000);

  const first = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  assert.equal(first.success, true);
  assert.equal(first.slips_created, 2, "one slip per payee");
  assert.equal(Number(first.total_disbursement), 850_000);

  const second = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  assert.equal(second.success, true);
  assert.equal(second.slips_created, 0, "no new slips on re-generation");
  assert.equal(second.reused_cycle, true);

  const { rows } = await db.query<{ n: number }>(`select count(*)::int n from public.payslip_records`);
  assert.equal(rows[0].n, 2, "still exactly two payslips");

  const { rows: nums } = await db.query<{ slip_number: string }>(`select slip_number from public.payslip_records order by slip_number`);
  assert.deepEqual(
    nums.map((r) => r.slip_number),
    ["PAY/2026/10/ELT-0001", "PAY/2026/10/ELT-0002"],
    "gap-free ELT numbering",
  );
});

test("ADMIN cannot disburse; FOUNDER can", async (t) => {
  const db = await bootstrap();
  t.after(async () => db.close());

  await addLine(db, CREW_A, 400_000);
  const gen = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 80, p_include_dividends: false,
  });
  assert.equal(gen.success, true);
  const cycleId = gen.cycle_id as string;

  const asAdmin = await rpc(db, "disburse_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 80, p_actor: ADMIN_UID,
  });
  assert.equal(asAdmin.success, false);
  assert.equal(asAdmin.error, "FORBIDDEN", "rank 80 must not disburse");

  const { rows: untouched } = await db.query<{ status: string }>(
    `select status from public.payroll_cycles where id = $1`, [cycleId],
  );
  assert.equal(untouched[0].status, "DRAFT", "a refused disbursal changes nothing");

  const asFounder = await rpc(db, "disburse_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 120, p_actor: FOUNDER_UID,
  });
  assert.equal(asFounder.success, true);
  assert.equal(asFounder.slips, 1);
});

test("disbursing marks every constituent line item PAID exactly once", async (t) => {
  const db = await bootstrap();
  t.after(async () => db.close());

  await addLine(db, CREW_A, 250_000);
  await addLine(db, CREW_A, 150_000); // second line, same payee -> one slip
  await addLine(db, CREW_B, 300_000);

  const gen = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  assert.equal(gen.slips_created, 2, "two payees -> two slips");
  const cycleId = gen.cycle_id as string;
  assert.equal(gen.lines_settled, 3, "three line items settled");

  const locked = await rpc(db, "lock_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 120, p_actor: FOUNDER_UID,
  });
  assert.equal(locked.status, "LOCKED");

  // A locked cycle must refuse new compensation rather than silently growing.
  await addLine(db, CREW_B, 99_000);
  const regen = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  assert.equal(regen.success, false);
  assert.equal(regen.error, "CYCLE_LOCKED");

  const disbursed = await rpc(db, "disburse_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 120, p_actor: FOUNDER_UID,
  });
  assert.equal(disbursed.success, true);

  const { rows } = await db.query<{ state: string; n: number; stamped: number }>(
    `select state, count(*)::int n, count(paid_at)::int stamped
       from public.compensation_line_items where payslip_id is not null group by state`,
  );
  assert.equal(rows.length, 1, "all settled lines share one state");
  assert.equal(rows[0].state, "PAID");
  assert.equal(rows[0].n, 3);
  assert.equal(rows[0].stamped, 3, "every paid line carries paid_at");

  // The un-slip'd line added after locking must remain untouched.
  const { rows: leftover } = await db.query<{ state: string }>(
    `select state from public.compensation_line_items where payslip_id is null`,
  );
  assert.equal(leftover.length, 1);
  assert.equal(leftover[0].state, "APPROVED", "post-lock line is not swept into the cycle");

  const { rows: audit } = await db.query<{ event: string }>(
    `select event from public.payroll_audit_log where cycle_id = $1 order by created_at`,
    [cycleId],
  );
  const events = audit.map((r) => r.event);
  assert.ok(events.includes("CYCLE_LOCKED"), "lock is audited");
  assert.ok(events.includes("CYCLE_DISBURSED"), "disbursement is audited");
});

test("cycle status transitions are rejected when already disbursed", async (t) => {
  const db = await bootstrap();
  t.after(async () => db.close());

  await addLine(db, CREW_A, 100_000);
  const gen = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  const cycleId = gen.cycle_id as string;
  await rpc(db, "disburse_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 120, p_actor: FOUNDER_UID,
  });

  const again = await rpc(db, "disburse_payroll_cycle", {
    p_cycle_id: cycleId, p_caller_rank: 120, p_actor: FOUNDER_UID,
  });
  assert.equal(again.success, false);
  assert.equal(again.error, "ALREADY_DISBURSED");

  const regen = await rpc(db, "generate_payroll_cycle", {
    p_period_key: "2026-10", p_caller_rank: 120, p_include_dividends: true,
  });
  assert.equal(regen.success, false);
  assert.equal(regen.error, "CYCLE_CLOSED");
});
