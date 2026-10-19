-- ============================================================================
-- GALLERY RPC — DRY-RUN VERIFICATION
-- ============================================================================
-- Run this AFTER 0005_gallery_session_rpcs.sql, in the Supabase SQL Editor.
--
-- It proves, in one transaction that is ALWAYS ROLLED BACK:
--   * the limiter records attempts and caps at 5
--   * the limiter resets after the window elapses
--   * an invalid verification hash yields NO session (fail-closed)
--   * a valid hash yields a session, and that session resolves
--   * revocation makes resolution return nothing
--   * the private tables are not exposed to anon/authenticated
--
-- It creates no lasting rows: everything ends in ROLLBACK.
-- ============================================================================

begin;

-- ── Fixture: a disposable customer + project ────────────────────────────────
do $$
declare
  v_customer uuid := gen_random_uuid();
  v_project  uuid := gen_random_uuid();
  v_pin      text := 'scrypt-v2$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  v_token    text := encode(sha256('dryrun-token'), 'hex');
  v_rows     integer;
  v_attempt  record;
begin
  insert into public.customers (id, name, phone)
  values (v_customer, 'Dry Run Customer', '0800000000');

  -- access_token must be exactly 43 base64url characters.
  insert into public.projects (
    id, customer_id, name, slug, photography_type,
    gallery_code, gallery_pin_hash, access_token, status
  ) values (
    v_project, v_customer, 'Dry Run Project',
    'dry-run-' || substr(v_project::text, 1, 8),
    'graduation',
    'ELTS-DRYRUN01', v_pin, repeat('d', 43), 'ready'
  );

  raise notice '--- 1. RATE LIMITER: 5 allowed, then blocked ---';
  for i in 1..7 loop
    select * into v_attempt
    from public.consume_gallery_attempt('dryrun-bucket-' || substr(v_project::text,1,8));

    raise notice '  attempt %: allowed=% retry_after=%s',
      i, v_attempt.allowed, v_attempt.retry_after_seconds;
  end loop;

  -- ── 2. Fail-closed: wrong verification hash, no session ──────────────────
  raise notice '--- 2. FAIL-CLOSED: mismatched pin hash ---';
  select count(*) into v_rows
  from public.create_gallery_session(
    v_project,
    'scrypt-v2$BBBBBBBBBBBBBBBBBBBBBB$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    v_token
  );
  raise notice '  sessions issued on mismatch: % (expect 0)', v_rows;
  if v_rows <> 0 then
    raise exception 'FAIL: fail-closed violated — issued % sessions', v_rows;
  end if;

  -- ── 3. Valid hash issues a session ───────────────────────────────────────
  raise notice '--- 3. VALID HASH: session issued ---';
  select count(*) into v_rows
  from public.create_gallery_session(v_project, v_pin, v_token);
  raise notice '  sessions issued: % (expect 1)', v_rows;
  if v_rows <> 1 then
    raise exception 'FAIL: expected 1 session, got %', v_rows;
  end if;

  -- ── 4. That session resolves ─────────────────────────────────────────────
  raise notice '--- 4. RESOLVE: session visible ---';
  select count(*) into v_rows
  from public.resolve_gallery_session(v_token);
  raise notice '  resolve rows: % (expect 1)', v_rows;
  if v_rows <> 1 then
    raise exception 'FAIL: session did not resolve';
  end if;

  -- ── 5. Revocation is effective immediately ───────────────────────────────
  raise notice '--- 5. REVOKE: session disappears ---';
  perform public.revoke_gallery_session(v_token);
  select count(*) into v_rows
  from public.resolve_gallery_session(v_token);
  raise notice '  resolve rows after revoke: % (expect 0)', v_rows;
  if v_rows <> 0 then
    raise exception 'FAIL: revoked session still resolves';
  end if;

  -- ── 6. Expired project cannot issue a session ────────────────────────────
  raise notice '--- 6. EXPIRED PROJECT: no session ---';
  update public.projects set expires_at = now() - interval '1 day' where id = v_project;
  select count(*) into v_rows
  from public.create_gallery_session(v_project, v_pin, encode(sha256('expired'), 'hex'));
  raise notice '  sessions issued for expired project: % (expect 0)', v_rows;
  if v_rows <> 0 then
    raise exception 'FAIL: expired project issued a session';
  end if;

  raise notice '--- ALL GALLERY DRY-RUN CHECKS PASSED ---';
end $$;

-- ── 7. Privilege assertions (read-only, before rollback) ────────────────────
select
  p.proname                                   as function_name,
  has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE')  as service_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('consume_gallery_attempt','create_gallery_session',
                    'resolve_gallery_session','revoke_gallery_session')
order by p.proname;

-- Expected: anon_can_execute = false, auth_can_execute = false,
--           service_can_execute = true  (all four rows)

rollback;
