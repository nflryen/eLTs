import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * Role tier management and payout-challenge regressions.
 *
 * These run the REAL migrations against PGlite. The invariants under test
 * (never zero roles, never the last SUPER_ADMIN, 42501 for non-super-admins)
 * are enforced in SQL, so testing them through TypeScript mocks would prove
 * nothing about the deployed behaviour.
 */

const ROOT = path.resolve(process.cwd(), "supabase", "migrations");

const SUPER = "aaaaaaaa-0000-0000-0000-000000000001";
const ADMIN = "aaaaaaaa-0000-0000-0000-000000000002";
const WORKER = "aaaaaaaa-0000-0000-0000-000000000003";
const SESSION = "bbbbbbbb-0000-0000-0000-000000000001";

/* ────────────────────────────────────────────────────────────────────────── */
test("non-SUPER_ADMIN cannot grant or revoke roles (42501)", async () => {
  const db = await boot();
  await seedUser(db, SUPER, ["SUPER_ADMIN"], "SUPER_ADMIN");
  await seedUser(db, ADMIN, ["ADMIN"], "ADMIN");
  await seedUser(db, WORKER, ["WORKER"], "WORKER");

  /* ADMIN (rank 80) attempts to grant itself FOUNDER. */
  await assert.rejects(
    () =>
      asUser(db, ADMIN, SESSION, `select public.grant_user_role('${ADMIN}'::uuid, 'FOUNDER')`),
    /only super_admin may manage roles/i,
    "ADMIN must not be able to grant roles",
  );

  /* WORKER (rank 60) attempts the same. */
  await assert.rejects(
    () =>
      asUser(db, WORKER, SESSION, `select public.grant_user_role('${WORKER}'::uuid, 'FOUNDER')`),
    /only super_admin may manage roles/i,
    "WORKER must not be able to grant roles",
  );

  /* Revocation is equally blocked. */
  await assert.rejects(
    () =>
      asUser(db, ADMIN, SESSION, `select public.revoke_user_role('${WORKER}'::uuid, 'WORKER')`),
    /only super_admin may manage roles/i,
    "ADMIN must not be able to revoke roles",
  );

  /* The roster read is blocked too — it returns an ERROR, not an empty list. */
  await assert.rejects(
    () => asUser(db, ADMIN, SESSION, `select * from public.list_users_with_roles()`),
    /only super_admin may manage roles/i,
    "ADMIN must not be able to enumerate roles",
  );

  /* Nothing changed. */
  const rank = await asUser(db, ADMIN, SESSION, `select private.current_role_rank()::int r`);
  assert.equal(rank.rows[0].r, 80, "ADMIN rank must be unchanged after failed escalation");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────── */
test("SUPER_ADMIN can add and remove a hybrid role without corrupting the composite key", async () => {
  const db = await boot();
  await seedUser(db, SUPER, ["SUPER_ADMIN"], "SUPER_ADMIN");
  await seedUser(db, WORKER, ["WORKER", "FOUNDER"], "WORKER");

  /* Add EDITOR -> hybrid WORKER + FOUNDER + EDITOR. */
  await asUser(db, SUPER, SESSION, `select public.grant_user_role('${WORKER}'::uuid, 'EDITOR')`);

  let roles = await rolesOf(db, WORKER);
  assert.deepEqual(roles, ["EDITOR", "FOUNDER", "WORKER"], "EDITOR must be added");

  /* Granting the same role twice must be idempotent, not a duplicate-key error. */
  await asUser(db, SUPER, SESSION, `select public.grant_user_role('${WORKER}'::uuid, 'EDITOR')`);
  roles = await rolesOf(db, WORKER);
  assert.deepEqual(roles, ["EDITOR", "FOUNDER", "WORKER"], "re-grant must not duplicate");

  /* Remove FOUNDER. */
  await asUser(db, SUPER, SESSION, `select public.revoke_user_role('${WORKER}'::uuid, 'FOUNDER')`);
  roles = await rolesOf(db, WORKER);
  assert.deepEqual(roles, ["EDITOR", "WORKER"], "FOUNDER must be removed");

  /* The composite PK is intact and still rejects a true duplicate row. */
  await assert.rejects(
    () =>
      db.query(
        `insert into public.role_assignments (user_id, role_key) values ($1::uuid, 'EDITOR')`,
        [WORKER],
      ),
    /duplicate key/i,
    "composite primary key must still prevent duplicate (user, role) rows",
  );

  /* Base role survived: WORKER was the default and was not removed. */
  const base = await db.query<{ role_key: string }>(
    `select role_key from public.role_assignments where user_id=$1::uuid and is_default`,
    [WORKER],
  );
  assert.equal(base.rows[0].role_key, "WORKER");

  /* Every mutation is audited. */
  const audit = await db.query<{ action: string; role_key: string }>(
    `select action, role_key from public.role_management_audit order by id`,
  );
  assert.deepEqual(
    audit.rows.map((r) => `${r.action}:${r.role_key}`),
    ["GRANT:EDITOR", "GRANT:EDITOR", "REVOKE:FOUNDER"],
    "each mutation must produce an audit row",
  );

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────── */
test("a user can never be left with zero roles", async () => {
  const db = await boot();
  await seedUser(db, SUPER, ["SUPER_ADMIN"], "SUPER_ADMIN");
  await seedUser(db, WORKER, ["WORKER"], "WORKER");

  await assert.rejects(
    () =>
      asUser(db, SUPER, SESSION, `select public.revoke_user_role('${WORKER}'::uuid, 'WORKER')`),
    /at least one role/i,
    "removing the only role must be refused",
  );

  assert.deepEqual(await rolesOf(db, WORKER), ["WORKER"], "role must remain");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────── */
test("the last SUPER_ADMIN cannot be stripped of the role", async () => {
  const db = await boot();
  await seedUser(db, SUPER, ["SUPER_ADMIN"], "SUPER_ADMIN");

  await assert.rejects(
    () =>
      asUser(db, SUPER, SESSION, `select public.revoke_user_role('${SUPER}'::uuid, 'SUPER_ADMIN')`),
    /last super_admin/i,
    "the sole SUPER_ADMIN must not be able to remove its own role",
  );

  assert.deepEqual(await rolesOf(db, SUPER), ["SUPER_ADMIN"]);

  /*
   * With a SECOND super admin present, demoting one is legal — but only if the
   * demoted account retains another role. Give it ADMIN so the zero-role
   * invariant is not the thing being tested here.
   */
  const other = "aaaaaaaa-0000-0000-0000-0000000000ff";
  await seedUser(db, other, ["SUPER_ADMIN", "ADMIN"], "SUPER_ADMIN");
  await asUser(
    db,
    SUPER,
    SESSION,
    `select public.revoke_user_role('${other}'::uuid, 'SUPER_ADMIN')`,
  );
  assert.deepEqual(await rolesOf(db, other), ["ADMIN"], "the second super admin may be demoted");
  assert.deepEqual(await rolesOf(db, SUPER), ["SUPER_ADMIN"], "the first is untouched");

  /* And the base role is promoted to the remaining role. */
  const promoted = await db.query<{ role_key: string }>(
    `select role_key from public.role_assignments where user_id=$1::uuid and is_default`,
    [other],
  );
  assert.equal(promoted.rows[0].role_key, "ADMIN", "ADMIN becomes the base role");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────── */
test("removing the base role promotes the highest remaining role to default", async () => {
  const db = await boot();
  await seedUser(db, SUPER, ["SUPER_ADMIN"], "SUPER_ADMIN");
  await seedUser(db, WORKER, ["WORKER", "EDITOR", "FOUNDER"], "WORKER");

  await asUser(db, SUPER, SESSION, `select public.revoke_user_role('${WORKER}'::uuid, 'WORKER')`);

  const base = await db.query<{ role_key: string }>(
    `select role_key from public.role_assignments where user_id=$1::uuid and is_default`,
    [WORKER],
  );
  assert.equal(base.rows.length, 1, "exactly one default must remain");
  assert.equal(base.rows[0].role_key, "FOUNDER", "highest remaining role becomes the base");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────── */
test("payout change is rejected without a valid password challenge", async () => {
  const db = await boot();
  await seedUser(db, WORKER, ["WORKER"], "WORKER");
  await db.query(
    `insert into public.user_profiles (user_id, full_name) values ($1::uuid, 'Ray')`,
    [WORKER],
  );

  await assert.rejects(
    () =>
      asUser(
        db,
        WORKER,
        SESSION,
        `select public.update_payout_with_challenge(
           'cccccccc-0000-0000-0000-000000000000'::uuid, 'BANK','BCA','Attacker','999',null,null)`,
      ),
    /password confirmation required/i,
    "a forged token must be refused",
  );

  const untouched = await db.query<{ bank_name: string | null }>(
    `select bank_name from public.user_profiles where user_id=$1::uuid`,
    [WORKER],
  );
  assert.equal(untouched.rows[0].bank_name, null, "no payout data may be written");

  /* A genuine token works, once. */
  const t = await db.query<{ t: string }>(
    `select public.mint_payout_challenge_token($1::uuid) t`,
    [WORKER],
  );
  await asUser(
    db,
    WORKER,
    SESSION,
    `select public.update_payout_with_challenge(
       '${t.rows[0].t}'::uuid, 'BANK','BCA','Ray','1234567890',null,null)`,
  );
  const written = await db.query<{ bank_name: string; bank_account_number: string }>(
    `select bank_name, bank_account_number from public.user_profiles where user_id=$1::uuid`,
    [WORKER],
  );
  assert.equal(written.rows[0].bank_name, "BCA");
  assert.equal(written.rows[0].bank_account_number, "1234567890");

  await assert.rejects(
    () =>
      asUser(
        db,
        WORKER,
        SESSION,
        `select public.update_payout_with_challenge(
           '${t.rows[0].t}'::uuid, 'BANK','BRI','Attacker','999',null,null)`,
      ),
    /password confirmation required/i,
    "a consumed token must not be replayable",
  );

  await db.close();
});

/* ──────────────────────────────────────────────────────────────────────────
 * Harness
 * ────────────────────────────────────────────────────────────────────────── */
async function boot(): Promise<PGlite> {
  const db = new PGlite();

  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create table auth.sessions(id uuid primary key, user_id uuid not null,
      created_at timestamptz not null default now(), updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant execute on function auth.jwt() to authenticated, service_role;

    create schema private;

    create table public.roles(
      key text primary key, label text not null, rank smallint not null,
      description text, is_staff boolean not null default true,
      created_at timestamptz not null default now());
    create table public.permissions(key text primary key);
    create table public.role_permissions(
      role_key text not null references public.roles(key) on delete cascade,
      permission_key text not null references public.permissions(key) on delete cascade,
      primary key (role_key, permission_key));
    create table public.role_assignments(
      user_id uuid primary key references auth.users(id) on delete cascade,
      role_key text not null references public.roles(key) on delete restrict,
      granted_by uuid references auth.users(id) on delete set null,
      granted_at timestamptz not null default now(),
      revoked_at timestamptz);
    create table public.admins(user_id uuid primary key references auth.users(id), display_name text);
    create table public.crew_members(
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid references auth.users(id),
      full_name text, phone text, email text,
      bank_name text, bank_account_number text, bank_account_holder text);

    create function private.legacy_admin_rank() returns smallint language sql stable as $$ select 0::smallint $$;
    create function private.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end $$;
    create function private.reject_audit_mutation() returns trigger language plpgsql as $$
      begin raise exception 'append-only (% blocked)', tg_op using errcode = 'insufficient_privilege'; end $$;
    /*
     * current_role_rank() must be declared BEFORE has_role_rank(), which calls
     * it. 0020 replaces current_role_rank() but never redefines has_role_rank(),
     * so has_role_rank must delegate rather than return a constant — a constant
     * stub would deny every caller, including SUPER_ADMIN.
     */
    create function private.current_role_rank() returns smallint language sql stable as $fn$
      select 0::smallint $fn$;
    create function private.has_role_rank(p_min integer) returns boolean language sql stable as $fn$
      select private.current_role_rank() >= p_min $fn$;

    insert into public.roles(key,label,rank) values
      ('CLIENT','Client',10),('FREELANCER','Field Crew',30),
      ('WORKER','Kreatif',60),('ADMIN','Operations Lead',80),
      ('FOUNDER','Founder',100),('SUPER_ADMIN','Super Admin',120);
  `);

  for (const file of [
    "0019_multi_role_session_context.sql",
    "0020_session_aware_roles.sql",
    "0021_user_profiles_and_payout.sql",
    "0023_role_management.sql",
  ]) {
    const sql = (await readFile(path.join(ROOT, file), "utf8"))
      .replace(/^\s*begin;\s*$/gim, "")
      .replace(/^\s*commit;\s*$/gim, "");
    await db.exec(sql);
  }

  return db;
}

async function seedUser(
  db: PGlite,
  userId: string,
  roles: string[],
  baseRole: string,
): Promise<void> {
  await db.query(`insert into auth.users(id, email) values ($1::uuid, $2)`, [
    userId,
    `${userId.slice(0, 8)}@example.test`,
  ]);
  /*
   * Session ids must be unique per user. Reusing one constant across several
   * users violates auth.sessions_pkey — a harness bug, not a schema issue.
   */
  await db.query(`insert into auth.sessions(id, user_id) values ($1::uuid, $2::uuid)`, [
    sessionFor(userId),
    userId,
  ]);
  for (const role of roles) {
    await db.query(
      `insert into public.role_assignments(user_id, role_key, is_default)
       values ($1::uuid, $2, $3)`,
      [userId, role, role === baseRole],
    );
  }
}

/** Deterministic per-user session id, so each seeded user gets a distinct one. */
function sessionFor(userId: string): string {
  return `bbbbbbbb-0000-0000-0000-${userId.slice(-12)}`;
}

async function rolesOf(db: PGlite, userId: string): Promise<string[]> {
  const r = await db.query<{ role_key: string }>(
    `select role_key from public.role_assignments
      where user_id=$1::uuid and revoked_at is null order by role_key`,
    [userId],
  );
  return r.rows.map((x) => String(x.role_key));
}

async function asUser(
  db: PGlite,
  userId: string,
  sessionId: string,
  sql: string,
): Promise<{ rows: Record<string, unknown>[] }> {
  void SESSION;
  await db.exec(`set request.jwt.claim.sub = '${userId}'`);
  await db.exec(
    `set request.jwt.claims = '${JSON.stringify({ sub: userId, session_id: sessionId })}'`,
  );
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
}
