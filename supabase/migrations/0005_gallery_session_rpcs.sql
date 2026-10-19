-- ============================================================================
-- ELTS STUDIO OS — GALLERY SESSION & RATE LIMITING RPCs
-- Migration: 0005_gallery_session_rpcs
-- ============================================================================
-- PURPOSE
-- -------
-- Re-assert the gallery access lifecycle in a self-contained, idempotent unit:
--
--   * private.gallery_rate_limits  — atomic fixed-window brute-force limiter
--   * private.gallery_sessions     — opaque, revocable gallery sessions
--   * consume_gallery_attempt()    — called BEFORE credential verification
--   * create_gallery_session()     — issues a session only for a verified hash
--   * resolve_gallery_session()    — session lookup used by every gateway
--   * revoke_gallery_session()     — logout / revocation
--
-- WHY THIS EXISTS SEPARATELY FROM 0001
-- ------------------------------------
-- These objects were verified working on the hosted project before this file
-- was written. This patch is a DEPLOY-ORDER SAFETY NET: it makes the gallery
-- lifecycle reproducible on a fresh database, and re-asserts grants if a
-- previous partial apply left them inconsistent. Every statement is
-- CREATE ... IF NOT EXISTS or CREATE OR REPLACE, so applying it to a healthy
-- database is a no-op that changes nothing but the function definitions.
--
-- SECURITY POSTURE (the part that matters)
-- ----------------------------------------
--   1. All four functions are SECURITY DEFINER with `SET search_path = ''` and
--      fully schema-qualified references. An empty search_path removes the
--      classic privilege-escalation vector: a caller cannot shadow `public` or
--      `pg_catalog` objects to redirect a definer-privileged call.
--   2. `consume_gallery_attempt`, `create_gallery_session`,
--      `resolve_gallery_session` and `revoke_gallery_session` are revoked from
--      PUBLIC, anon and authenticated and granted to service_role ONLY. The
--      browser never calls them directly; the Next.js server does.
--   3. The private tables are not exposed through PostgREST and have no grants
--      to anon/authenticated.
--   4. Fail-closed: an exhausted bucket returns allowed = false; an invalid
--      verification hash returns zero rows rather than raising, so the caller
--      produces one generic response and cannot distinguish "wrong PIN" from
--      "no such project".
--
-- IDEMPOTENT and ADDITIVE. No DROP TABLE, no data deletion, single transaction.
-- ============================================================================

begin;

-- ── 1. Schema guards ────────────────────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- ── 2. Session table ────────────────────────────────────────────────────────
create table if not exists private.gallery_sessions (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  gallery_access boolean not null default true,
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (project_id, id),
  check (expires_at > created_at)
);

create index if not exists gallery_sessions_project_id_idx
  on private.gallery_sessions (project_id);
create index if not exists gallery_sessions_expiry_idx
  on private.gallery_sessions (expires_at);

-- Composite FK target required by public.favorites(project_id, session_id).
do $$ begin
  alter table private.gallery_sessions
    add constraint gallery_sessions_project_id_id_key unique (project_id, id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end $$;

-- ── 3. Rate limit table ─────────────────────────────────────────────────────
create table if not exists private.gallery_rate_limits (
  bucket_key text primary key check (length(bucket_key) <= 128),
  attempts   integer not null check (attempts > 0),
  resets_at  timestamptz not null
);

create index if not exists gallery_rate_limits_resets_idx
  on private.gallery_rate_limits (resets_at);

-- ── 4. Grants on the private tables ─────────────────────────────────────────
-- Intentionally NOT granted to anon or authenticated: these tables are reached
-- only through the SECURITY DEFINER functions below.
revoke all on private.gallery_sessions, private.gallery_rate_limits
  from public, anon, authenticated;
grant all on private.gallery_sessions, private.gallery_rate_limits
  to service_role;

alter table private.gallery_sessions    enable row level security;
alter table private.gallery_rate_limits enable row level security;

-- ── 5. Brute-force limiter ──────────────────────────────────────────────────
-- Fixed 10-minute window, maximum 5 attempts, atomic upsert.
-- Call BEFORE verifying a PIN so a wrong guess is counted even when the code
-- does not exist.
create or replace function public.consume_gallery_attempt(p_bucket_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now        timestamptz := clock_timestamp();
  v_attempts   integer;
  v_resets_at  timestamptz;
  c_window     constant interval  := interval '10 minutes';
  c_max        constant integer   := 5;
begin
  -- Reject unusable keys rather than silently sharing one bucket between all
  -- callers, which would either lock everyone out or bypass the limit.
  if p_bucket_key is null or length(p_bucket_key) not between 1 and 128 then
    raise exception 'Invalid rate limit key';
  end if;

  insert into private.gallery_rate_limits as limits (bucket_key, attempts, resets_at)
  values (p_bucket_key, 1, v_now + c_window)
  on conflict (bucket_key) do update set
    attempts = case
                 when limits.resets_at <= v_now then 1
                 else least(limits.attempts + 1, 1000000)
               end,
    resets_at = case
                  when limits.resets_at <= v_now then v_now + c_window
                  else limits.resets_at
                end
  returning limits.attempts, limits.resets_at into v_attempts, v_resets_at;

  -- Fail closed: the caller receives `false` and a retry hint, never a
  -- database error, so an attacker learns nothing about the internal state.
  return query
    select
      v_attempts <= c_max,
      greatest(0, ceil(extract(epoch from v_resets_at - v_now))::integer);
end;
$$;

revoke all on function public.consume_gallery_attempt(text)
  from public, anon, authenticated;
grant execute on function public.consume_gallery_attempt(text) to service_role;

-- ── 6. Session issuance ─────────────────────────────────────────────────────
-- Issues a row ONLY when the supplied hash matches the project's CURRENT stored
-- hash and the project is deliverable. The row lock (`FOR UPDATE`) makes a
-- concurrent PIN reset invalidate this login rather than racing it.
--
-- A legacy scrypt-v1 hash can be upgraded in the same atomic step by passing
-- p_upgraded_pin_hash; the credential is never reset without a successful
-- verification.
create or replace function public.create_gallery_session(
  p_project_id        uuid,
  p_verified_pin_hash text,
  p_token_hash        text,
  p_upgraded_pin_hash text default null
)
returns table (session_id uuid, project_id uuid, access_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project    public.projects%rowtype;
  v_session_id uuid;
  v_expires_at timestamptz;
begin
  select * into v_project from public.projects where id = p_project_id for update;

  -- Fail closed with an EMPTY RESULT, not an exception: the caller renders one
  -- generic "invalid code or PIN" message and cannot tell these cases apart.
  if not found
     or v_project.gallery_pin_hash is distinct from p_verified_pin_hash
     or v_project.status <> 'ready'
     or (v_project.expires_at is not null and v_project.expires_at <= clock_timestamp())
  then
    return;
  end if;

  if p_upgraded_pin_hash is not null then
    if p_upgraded_pin_hash !~ '^scrypt-v2\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' then
      raise exception 'Invalid credential upgrade';
    end if;
    update public.projects
       set gallery_pin_hash = p_upgraded_pin_hash
     where id = p_project_id;
  end if;

  -- 12 hours, clamped to the project's own expiry.
  v_expires_at := least(
    clock_timestamp() + interval '12 hours',
    coalesce(v_project.expires_at, 'infinity'::timestamptz)
  );

  insert into private.gallery_sessions (project_id, token_hash, expires_at)
  values (p_project_id, p_token_hash, v_expires_at)
  returning id into v_session_id;

  return query
    select v_session_id, p_project_id, v_project.access_token, v_expires_at;
end;
$$;

revoke all on function public.create_gallery_session(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_gallery_session(uuid, text, text, text)
  to service_role;

-- ── 7. Session resolution ───────────────────────────────────────────────────
-- Called by every media gateway request. Returns nothing when the session is
-- revoked, expired, or its project is no longer deliverable.
create or replace function public.resolve_gallery_session(p_token_hash text)
returns table (session_id uuid, project_id uuid, access_token text, slug text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.project_id,
    p.access_token,
    p.slug,
    least(s.expires_at, coalesce(p.expires_at, 'infinity'::timestamptz))
  from private.gallery_sessions s
  join public.projects p on p.id = s.project_id
  where s.token_hash = p_token_hash
    and s.gallery_access
    and s.revoked_at is null
    and s.expires_at > now()
    and p.status = 'ready'
    and (p.expires_at is null or p.expires_at > now());
$$;

revoke all on function public.resolve_gallery_session(text)
  from public, anon, authenticated;
grant execute on function public.resolve_gallery_session(text) to service_role;

-- ── 8. Session revocation ───────────────────────────────────────────────────
create or replace function public.revoke_gallery_session(p_token_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.gallery_sessions
     set revoked_at = now()
   where token_hash = p_token_hash
     and revoked_at is null;
$$;

revoke all on function public.revoke_gallery_session(text)
  from public, anon, authenticated;
grant execute on function public.revoke_gallery_session(text) to service_role;

-- ── 9. Verification ─────────────────────────────────────────────────────────
do $$
declare
  v_count integer;
begin
  -- All four functions must exist.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('consume_gallery_attempt','create_gallery_session',
                      'resolve_gallery_session','revoke_gallery_session');
  if v_count <> 4 then
    raise exception 'gallery: expected 4 functions, found %', v_count;
  end if;

  -- None may be executable by anon or authenticated.
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('consume_gallery_attempt','create_gallery_session',
                        'resolve_gallery_session','revoke_gallery_session')
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ) then
    raise exception 'gallery: a session RPC is executable by anon/authenticated';
  end if;

  raise notice 'gallery: RPCs present, SECURITY DEFINER, service_role only';
end $$;

commit;
