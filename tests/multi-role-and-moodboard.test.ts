import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  canPerformMoodboardAction,
  deriveCommentAuthor,
  resolveMoodboardPrincipal,
} from "../src/lib/auth/moodboard-access";

/*
 * Multi-role, session-context, and moodboard authorization regressions.
 *
 * The database assertions run the REAL migration files against PGlite, so they
 * fail if the SQL and the TypeScript drift apart. The authorization assertions
 * are pure and run with no database at all.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Escalation without password verification is rejected
 * ──────────────────────────────────────────────────────────────────────────── */
test("escalation to FOUNDER without a valid challenge token is rejected", async () => {
  const db = await bootSessionContextDb();
  const ray = "11111111-1111-1111-1111-111111111111";
  const sessionId = "22222222-2222-2222-2222-222222222222";

  await seedUser(db, ray, sessionId, ["WORKER", "EDITOR", "FOUNDER"], "WORKER");

  /* No token at all — must be refused. */
  await assert.rejects(
    () => asUser(db, ray, sessionId, `select public.set_active_role('FOUNDER', null)`),
    /challenge required/i,
    "an unchallenged escalation must be rejected",
  );

  /* A fabricated token — must be refused identically. */
  await assert.rejects(
    () =>
      asUser(
        db,
        ray,
        sessionId,
        `select public.set_active_role('FOUNDER', '33333333-3333-3333-3333-333333333333'::uuid)`,
      ),
    /challenge required/i,
    "a forged token must not elevate",
  );

  /* The role must be unchanged. */
  const rank = await asUser(
    db,
    ray,
    sessionId,
    `select private.current_role_rank()::int as r`,
  );
  assert.equal(rank.rows[0].r, 60, "rank must remain WORKER (60) after failed escalations");

  /* With a real, session-bound, unexpired token it succeeds. */
  const token = await db.query<{ t: string }>(
    `select public.mint_role_challenge_token($1::uuid, $2::uuid, 'FOUNDER') as t`,
    [ray, sessionId],
  );
  await asUser(
    db,
    ray,
    sessionId,
    `select public.set_active_role('FOUNDER', '${token.rows[0].t}'::uuid)`,
  );

  const elevated = await asUser(
    db,
    ray,
    sessionId,
    `select private.current_role_rank()::int as r`,
  );
  assert.equal(elevated.rows[0].r, 100, "a valid challenge must elevate to FOUNDER (100)");

  /*
   * Single-use enforcement.
   *
   * Re-asserting FOUNDER while already FOUNDER is a LATERAL move (100 -> 100),
   * which correctly requires no challenge — so the replay attack is only
   * meaningful after a downgrade. Drop to WORKER, then try to replay the
   * already-consumed token to climb back to FOUNDER.
   */
  await asUser(db, ray, sessionId, `select public.set_active_role('WORKER', null)`);

  const afterDowngrade = await asUser(
    db,
    ray,
    sessionId,
    `select private.current_role_rank()::int as r`,
  );
  assert.equal(afterDowngrade.rows[0].r, 60, "downgrade must apply without a challenge");

  await assert.rejects(
    () =>
      asUser(
        db,
        ray,
        sessionId,
        `select public.set_active_role('FOUNDER', '${token.rows[0].t}'::uuid)`,
      ),
    /challenge required/i,
    "a consumed token must not be replayable after a downgrade",
  );

  const stillDown = await asUser(
    db,
    ray,
    sessionId,
    `select private.current_role_rank()::int as r`,
  );
  assert.equal(stillDown.rows[0].r, 60, "a replayed token must not re-elevate");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Expired elevation falls back to the base rank
 * ──────────────────────────────────────────────────────────────────────────── */
test("expired or revoked elevation contexts fall back to the base rank", async () => {
  const db = await bootSessionContextDb();
  const ray = "44444444-4444-4444-4444-444444444444";
  const sessionId = "55555555-5555-5555-5555-555555555555";

  await seedUser(db, ray, sessionId, ["WORKER", "EDITOR", "FOUNDER"], "WORKER");

  /* Elevate with a genuine token. */
  const token = await db.query<{ t: string }>(
    `select public.mint_role_challenge_token($1::uuid, $2::uuid, 'FOUNDER') as t`,
    [ray, sessionId],
  );
  await asUser(db, ray, sessionId, `select public.set_active_role('FOUNDER', '${token.rows[0].t}'::uuid)`);

  let rank = await asUser(db, ray, sessionId, `select private.current_role_rank()::int as r`);
  assert.equal(rank.rows[0].r, 100);

  /* Force the deadline into the past. */
  await db.query(
    `update public.user_session_context set elevated_until = now() - interval '1 second' where session_id = $1::uuid`,
    [sessionId],
  );

  rank = await asUser(db, ray, sessionId, `select private.current_role_rank()::int as r`);
  assert.equal(rank.rows[0].r, 60, "an expired elevation must fall back to the base role");

  /* A revoked role must not be usable as an active context either. */
  const token2 = await db.query<{ t: string }>(
    `select public.mint_role_challenge_token($1::uuid, $2::uuid, 'FOUNDER') as t`,
    [ray, sessionId],
  );
  await asUser(db, ray, sessionId, `select public.set_active_role('FOUNDER', '${token2.rows[0].t}'::uuid)`);
  await db.query(
    `update public.role_assignments set revoked_at = now() where user_id = $1::uuid and role_key = 'FOUNDER'`,
    [ray],
  );

  rank = await asUser(db, ray, sessionId, `select private.current_role_rank()::int as r`);
  assert.equal(rank.rows[0].r, 60, "a revoked role must not remain active");

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Payout change requires the password challenge
 * ──────────────────────────────────────────────────────────────────────────── */
test("payout updates fail without a valid challenge token", async () => {
  const db = await bootSessionContextDb();
  const ray = "66666666-6666-6666-6666-666666666666";
  const sessionId = "77777777-7777-7777-7777-777777777777";

  await seedUser(db, ray, sessionId, ["WORKER", "FOUNDER"], "WORKER");
  await db.query(
    `insert into public.user_profiles (user_id, full_name) values ($1::uuid, 'Ray')`,
    [ray],
  );

  /* Wrong/forged token — refused. */
  await assert.rejects(
    () =>
      asUser(
        db,
        ray,
        sessionId,
        `select public.update_payout_with_challenge(
           '88888888-8888-8888-8888-888888888888'::uuid, 'BANK', 'BCA', 'Ray', '1234567890', null, null)`,
      ),
    /password confirmation required/i,
    "a forged payout token must be refused",
  );

  /* Bank details must be untouched. */
  const before = await db.query<{ n: number }>(
    `select count(*)::int as n from public.user_profiles where user_id = $1::uuid and bank_name is not null`,
    [ray],
  );
  assert.equal(before.rows[0].n, 0, "no payout data may be written on a failed challenge");

  /* A genuine token succeeds, and is single-use. */
  const token = await db.query<{ t: string }>(
    `select public.mint_payout_challenge_token($1::uuid) as t`,
    [ray],
  );
  await asUser(
    db,
    ray,
    sessionId,
    `select public.update_payout_with_challenge(
       '${token.rows[0].t}'::uuid, 'BANK', 'BCA', 'Ray', '1234567890', null, null)`,
  );

  const after = await db.query<{ bank_name: string }>(
    `select bank_name from public.user_profiles where user_id = $1::uuid`,
    [ray],
  );
  assert.equal(after.rows[0].bank_name, "BCA");

  await assert.rejects(
    () =>
      asUser(
        db,
        ray,
        sessionId,
        `select public.update_payout_with_challenge(
           '${token.rows[0].t}'::uuid, 'BANK', 'BRI', 'Attacker', '999', null, null)`,
      ),
    /password confirmation required/i,
    "a consumed payout token must not be replayable",
  );

  await db.close();
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Moodboard actions cannot be manipulated anonymously
 * ──────────────────────────────────────────────────────────────────────────── */
test("moodboard authorization denies anonymous callers and prevents identity spoofing", () => {
  const projectId = "99999999-9999-9999-9999-999999999999";

  /* No staff session, no gallery session -> deny everything. */
  const anonymous = resolveMoodboardPrincipal({
    staff: null,
    galleryProjectId: null,
    projectId,
  });
  assert.equal(anonymous, null, "an anonymous caller must resolve to no principal");

  for (const action of [
    "read",
    "createCard",
    "toggleShotListItem",
    "comment",
    "deleteCard",
    "seedDefaults",
  ] as const) {
    assert.equal(
      canPerformMoodboardAction(anonymous, action),
      false,
      `anonymous must not be able to ${action}`,
    );
  }

  /* A gallery session for a DIFFERENT project must not grant access. */
  const wrongProject = resolveMoodboardPrincipal({
    staff: null,
    galleryProjectId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    projectId,
  });
  assert.equal(wrongProject, null, "a gallery session is scoped to its own project");

  /* A low-rank staff member (below WORKER) must not reach the board. */
  const lowRank = resolveMoodboardPrincipal({
    staff: { userId: "u1", name: "Freelancer", rank: 30 },
    galleryProjectId: null,
    projectId,
  });
  assert.equal(lowRank, null, "staff below rank 60 must not resolve to a studio principal");

  /* A genuine client may comment and tick items, but not delete or seed. */
  const client = resolveMoodboardPrincipal({
    staff: null,
    galleryProjectId: projectId,
    projectId,
  });
  assert.deepEqual(client, { kind: "CLIENT", projectId, name: "Client" });
  assert.equal(canPerformMoodboardAction(client, "comment"), true);
  assert.equal(canPerformMoodboardAction(client, "toggleShotListItem"), true);
  assert.equal(canPerformMoodboardAction(client, "deleteCard"), false);
  assert.equal(canPerformMoodboardAction(client, "seedDefaults"), false);
  assert.equal(canPerformMoodboardAction(client, "createCard", "TECH_NOTE"), false);

  /* The comment author is DERIVED — a client cannot claim to be STUDIO. */
  assert.deepEqual(deriveCommentAuthor(client), { role: "CLIENT", name: "Client" });

  const studio = resolveMoodboardPrincipal({
    staff: { userId: "u2", name: "Ray", rank: 100 },
    galleryProjectId: null,
    projectId,
  });
  assert.equal(canPerformMoodboardAction(studio, "deleteCard"), true);
  assert.deepEqual(deriveCommentAuthor(studio!), { role: "STUDIO", name: "Ray" });
});

/* ────────────────────────────────────────────────────────────────────────────
 * Harness: boots the real session-context SQL against PGlite
 * ──────────────────────────────────────────────────────────────────────────── */
async function bootSessionContextDb(): Promise<PGlite> {
  const db = new PGlite();

  /*
   * Supabase-owned objects the migrations reference but PGlite does not have.
   * These are the ONLY stand-ins; the migration files themselves run VERBATIM,
   * so a syntax error or a wrong column in the real SQL fails this test.
   */
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create table auth.sessions(
      id uuid primary key,
      user_id uuid not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;

    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;
    grant execute on function auth.jwt() to authenticated, service_role;

    create schema private;

    /* ── Pre-existing spine this migration builds on (0002_rbac_core) ────── */
    create table public.roles(
      key text primary key,
      label text not null,
      rank smallint not null,
      description text,
      is_staff boolean not null default true,
      created_at timestamptz not null default now()
    );
    create table public.permissions(key text primary key);
    create table public.role_permissions(
      role_key text not null references public.roles(key) on delete cascade,
      permission_key text not null references public.permissions(key) on delete cascade,
      primary key (role_key, permission_key)
    );
    /* Pre-migration shape: PRIMARY KEY (user_id) — the migration widens it. */
    create table public.role_assignments(
      user_id uuid primary key references auth.users(id) on delete cascade,
      role_key text not null references public.roles(key) on delete restrict,
      granted_by uuid references auth.users(id) on delete set null,
      granted_at timestamptz not null default now(),
      revoked_at timestamptz
    );
    create table public.admins(user_id uuid primary key references auth.users(id), display_name text);
    create table public.crew_members(
      id uuid primary key default gen_random_uuid(),
      auth_user_id uuid references auth.users(id),
      full_name text, phone text, email text,
      bank_name text, bank_account_number text, bank_account_holder text
    );

    create function private.legacy_admin_rank() returns smallint language sql stable as $$ select 0::smallint $$;
    create function private.set_updated_at() returns trigger language plpgsql as $$
      begin new.updated_at = now(); return new; end $$;
    create function private.reject_audit_mutation() returns trigger language plpgsql as $$
      begin raise exception 'append-only (% blocked)', tg_op using errcode = 'insufficient_privilege'; end $$;
    /* Stub replaced by 0020; policies in 0019/0021 reference it at CREATE time. */
    /*
     * Stand-in for 0002's definition. It MUST delegate to current_role_rank()
     * rather than returning a constant: 0020 replaces current_role_rank() but
     * never redefines has_role_rank(), so a select-false stub here would
     * silently deny every caller — including SUPER_ADMIN.
     */
    create function private.current_role_rank() returns smallint language sql stable as $fn$
      select 0::smallint
    $fn$;
    create function private.has_role_rank(p_min integer) returns boolean language sql stable as $fn$
      select private.current_role_rank() >= p_min
    $fn$;

    insert into public.roles(key,label,rank) values
      ('CLIENT','Client',10),('FREELANCER','Field Crew',30),
      ('WORKER','Kreatif',60),('ADMIN','Operations Lead',80),
      ('FOUNDER','Founder',100),('SUPER_ADMIN','Super Admin',120);
  `);

  /*
   * Run the REAL migration files, in order, unmodified.
   *
   * `begin;`/`commit;` are stripped only because PGlite's exec manages its own
   * transaction boundary; no statement content is altered.
   */
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), "supabase", "migrations");

  for (const file of [
    "0019_multi_role_session_context.sql",
    "0020_session_aware_roles.sql",
    "0021_user_profiles_and_payout.sql",
  ]) {
    const sql = (await fs.readFile(path.join(root, file), "utf8"))
      .replace(/^\s*begin;\s*$/gim, "")
      .replace(/^\s*commit;\s*$/gim, "");
    await db.exec(sql);
  }

  return db;
}

/** Inserts a user with a set of roles and an explicit base role. */
async function seedUser(
  db: PGlite,
  userId: string,
  sessionId: string,
  roles: string[],
  baseRole: string,
): Promise<void> {
  await db.query(`insert into auth.users(id, email) values ($1::uuid, 'u@example.test')`, [userId]);
  await db.query(`insert into auth.sessions(id, user_id) values ($1::uuid, $2::uuid)`, [
    sessionId,
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

/**
 * Executes SQL as a given authenticated user.
 *
 * Sets the same GUCs PostgREST sets, so `auth.uid()` and the `session_id` claim
 * resolve exactly as they do in production.
 */
async function asUser(
  db: PGlite,
  userId: string,
  sessionId: string,
  sql: string,
): Promise<{ rows: Record<string, unknown>[] }> {
  await db.exec(`set request.jwt.claim.sub = '${userId}'`);
  await db.exec(
    `set request.jwt.claims = '${JSON.stringify({ sub: userId, session_id: sessionId })}'`,
  );
  const res = await db.query(sql);
  return { rows: res.rows as Record<string, unknown>[] };
}
