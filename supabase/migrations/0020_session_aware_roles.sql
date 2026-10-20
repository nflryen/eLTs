begin;

/*
 * 0020 — Session-aware role resolution and the password-challenge RPCs.
 *
 * This file is the single point of substitution for the entire RLS surface.
 * All 62 rank-gated policies call `private.has_role_rank()`, which calls
 * `private.current_role_rank()`, which calls `private.current_role()`. Replacing
 * `current_role()` therefore changes every policy at once; no policy file is
 * touched.
 */

-- ── 1. Active role ──────────────────────────────────────────────────────────
/*
 * Precedence:
 *   1. A session context row whose role is STILL held and, when elevated, not
 *      yet expired.
 *   2. Otherwise the account's explicit base role (`is_default`).
 *   3. Otherwise the highest-ranked live role held.
 *   4. Otherwise the legacy `public.admins` fallback.
 *
 * Every branch fails CLOSED: an unknown session, a revoked role, or an expired
 * elevation collapses to a LOWER rank, never a higher one.
 */
create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  with session_role as (
    select c.active_role
    from public.user_session_context c
    join public.role_assignments ra
      on ra.user_id = c.user_id
     and ra.role_key = c.active_role
     and ra.revoked_at is null
    where c.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
      and c.user_id    = (select auth.uid())
      and (c.elevated_until is null or c.elevated_until > now())
    limit 1
  ),
  base_role as (
    select ra.role_key
    from public.role_assignments ra
    where ra.user_id = (select auth.uid())
      and ra.revoked_at is null
      and ra.is_default
    limit 1
  ),
  best_owned as (
    select ra.role_key
    from public.role_assignments ra
    join public.roles r on r.key = ra.role_key
    where ra.user_id = (select auth.uid())
      and ra.revoked_at is null
    order by r.rank desc
    limit 1
  )
  select coalesce(
    (select active_role from session_role),
    (select role_key    from base_role),
    (select role_key    from best_owned),
    case when private.legacy_admin_rank() > 0 then 'ADMIN' else null end
  );
$$;

create or replace function private.current_role_rank() returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.rank from public.roles r where r.key = private.current_role()),
    0::smallint
  );
$$;

/*
 * Permission checks MUST resolve through the same active role.
 *
 * The previous body joined `role_assignments` directly, which after the
 * junction change would have granted the UNION of every owned role — so a user
 * who downgraded to EDITOR would still pass `has_permission('invoice.settle')`
 * because they also hold FOUNDER. That is a silent privilege-escalation bug,
 * and it is why this function is rewritten here rather than left alone.
 */
create or replace function private.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_permissions rp
    where rp.role_key = private.current_role()
      and rp.permission_key = p_key
  );
$$;

-- ── 2. Challenge token minting (service_role only) ──────────────────────────
/*
 * Called by the application ONLY after `signInWithPassword` has succeeded.
 *
 * SECURITY MODEL
 * --------------
 * `authenticated` cannot execute this, so a browser cannot mint its own token.
 * The token is bound to (user, session, target role) and lives for 2 minutes —
 * long enough for the immediate `set_active_role` call, far too short to be
 * useful if it leaks. It is single-use (`consumed_at`).
 */
create or replace function public.mint_role_challenge_token(
  p_user_id     uuid,
  p_session_id  uuid,
  p_target_role text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_token uuid;
begin
  if not exists (select 1 from public.roles r where r.key = p_target_role) then
    raise exception 'Unknown role %', p_target_role using errcode = 'check_violation';
  end if;

  insert into public.role_challenge_tokens (user_id, session_id, target_role, expires_at)
  values (p_user_id, p_session_id, p_target_role, now() + interval '2 minutes')
  returning id into v_token;

  return v_token;
end $$;

revoke all on function public.mint_role_challenge_token(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mint_role_challenge_token(uuid, uuid, text) to service_role;

-- ── 3. set_active_role ──────────────────────────────────────────────────────
/*
 * The ONLY writer of `user_session_context`.
 *
 * `p_challenge_token` is required for any escalation and ignored otherwise.
 * A NULL token on escalation is rejected; a token that is unknown, expired,
 * already consumed, or bound to a different user/session/role is rejected
 * identically (no oracle).
 *
 * TTL: 30 minutes for FOUNDER and SUPER_ADMIN contexts, as specified. Other
 * escalations (e.g. WORKER -> ADMIN) also get a TTL — any upward move is
 * elevation, and treating some escalations as permanent would be arbitrary.
 */
create or replace function public.set_active_role(
  p_role_name       text,
  p_challenge_token uuid default null
) returns table (
  active_role    text,
  active_rank    smallint,
  elevated_until timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid        uuid := (select auth.uid());
  v_session    uuid := nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  v_target_rank smallint;
  v_prior_rank  smallint := coalesce(private.current_role_rank(), 0);
  v_current     text := private.current_role();
  v_holds       boolean;
  v_is_escalation boolean;
  v_token_ok    boolean := false;
  v_ttl         interval;
begin
  if v_uid is null or v_session is null then
    raise exception 'No authenticated session' using errcode = 'insufficient_privilege';
  end if;

  select r.rank into v_target_rank from public.roles r where r.key = p_role_name;
  if v_target_rank is null then
    raise exception 'Unknown role %', p_role_name using errcode = 'check_violation';
  end if;

  -- The caller must actually hold the role. Never trust the request.
  select exists (
    select 1 from public.role_assignments ra
    where ra.user_id = v_uid
      and ra.role_key = p_role_name
      and ra.revoked_at is null
  ) into v_holds;

  if not v_holds then
    insert into public.role_switch_audit
      (user_id, session_id, from_role, to_role, actor_rank, event, detail)
    values (v_uid, v_session, v_current, p_role_name, v_prior_rank, 'CHALLENGE_FAILED',
            jsonb_build_object('reason', 'role_not_held'));
    raise exception 'Role not held' using errcode = 'insufficient_privilege';
  end if;

  v_is_escalation := v_target_rank > v_prior_rank;

  if v_is_escalation then
    /*
     * Verify and CONSUME the token atomically. The `for update` prevents two
     * concurrent requests from both succeeding with one token.
     */
    if p_challenge_token is not null then
      update public.role_challenge_tokens t
         set consumed_at = now()
       where t.id           = p_challenge_token
         and t.user_id      = v_uid
         and t.session_id   = v_session
         and t.target_role  = p_role_name
         and t.consumed_at is null
         and t.expires_at   > now()
      returning true into v_token_ok;
    end if;

    if not coalesce(v_token_ok, false) then
      insert into public.role_switch_audit
        (user_id, session_id, from_role, to_role, actor_rank, event, detail)
      values (v_uid, v_session, v_current, p_role_name, v_prior_rank, 'CHALLENGE_FAILED',
              jsonb_build_object('reason', 'invalid_or_expired_token'));
      raise exception 'Password challenge required for escalation'
        using errcode = 'insufficient_privilege';
    end if;

    insert into public.role_switch_audit
      (user_id, session_id, from_role, to_role, actor_rank, event, detail)
    values (v_uid, v_session, v_current, p_role_name, v_prior_rank, 'CHALLENGE_OK', '{}'::jsonb);
  end if;

  /*
   * TTL applies only to elevation. A downgrade must not carry an expiry, or
   * `elevated_until` stops meaning "elevated until".
   */
  v_ttl := case when v_is_escalation then interval '30 minutes' else null end;

  insert into public.user_session_context
    (session_id, user_id, active_role, elevated_until, established_by, updated_at)
  values
    (v_session, v_uid, p_role_name,
     case when v_ttl is null then null else now() + v_ttl end,
     case when v_is_escalation then 'CHALLENGE' else 'DOWNGRADE' end,
     now())
  on conflict (session_id) do update
    set active_role    = excluded.active_role,
        elevated_until = excluded.elevated_until,
        established_by = excluded.established_by,
        updated_at     = now();

  insert into public.role_switch_audit
    (user_id, session_id, from_role, to_role, actor_rank, event, detail)
  values
    (v_uid, v_session, v_current, p_role_name, v_prior_rank,
     case when v_is_escalation then 'SWITCH' else 'DOWNGRADE' end,
     jsonb_build_object('ttl_minutes',
       case when v_ttl is null then null else 30 end));

  return query
    select c.active_role, v_target_rank, c.elevated_until
    from public.user_session_context c
    where c.session_id = v_session;
end $$;

revoke all on function public.set_active_role(text, uuid) from public, anon;
grant execute on function public.set_active_role(text, uuid) to authenticated, service_role;

-- ── 4. Self-service context read ────────────────────────────────────────────
/*
 * The UI needs the active role, its rank, and the remaining elevation time to
 * render the correct shell and the countdown badge. Exposed as an RPC because
 * `private` is not an exposed schema.
 */
create or replace function public.get_my_role_context()
returns table (
  role_key       text,
  role_rank      smallint,
  elevated_until timestamptz,
  owned_roles    text[]
)
language sql stable security definer set search_path = '' as $$
  select
    private.current_role(),
    private.current_role_rank(),
    (select c.elevated_until
       from public.user_session_context c
      where c.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
        and c.user_id = (select auth.uid())),
    coalesce(
      (select array_agg(ra.role_key order by r.rank desc)
         from public.role_assignments ra
         join public.roles r on r.key = ra.role_key
        where ra.user_id = (select auth.uid())
          and ra.revoked_at is null),
      '{}'::text[]
    );
$$;

revoke all on function public.get_my_role_context() from public, anon;
grant execute on function public.get_my_role_context() to authenticated, service_role;

-- ── 5. Seed the base role for existing single-role accounts ─────────────────
/*
 * Every pre-existing assignment becomes the account's default, preserving the
 * current behaviour exactly: a user who had one role keeps resolving to it.
 */
update public.role_assignments
   set is_default = true
 where revoked_at is null
   and user_id in (
     select user_id from public.role_assignments
      where revoked_at is null
      group by user_id
     having count(*) = 1
   );

-- ── 6. Staff directory must survive the junction change ─────────────────────
/*
 * The old view returned one row per user. With a junction it would return one
 * row per (user, role), which breaks every consumer that assumes a single
 * role per row. Aggregate instead: one row per account, with its role set and
 * its base role.
 */
drop view if exists public.v_staff_directory;
create view public.v_staff_directory as
select
  ra.user_id,
  (array_agg(ra.role_key order by r.rank desc))[1]        as role_key,
  (array_agg(r.label     order by r.rank desc))[1]        as role_label,
  max(r.rank)::smallint                                    as role_rank,
  (array_agg(ra.role_key order by r.rank desc) filter (where ra.is_default))[1]
                                                           as base_role_key,
  array_agg(ra.role_key order by r.rank desc)              as all_roles,
  max(a.display_name)                                      as display_name,
  min(ra.granted_at)                                       as granted_at
from public.role_assignments ra
join public.roles r on r.key = ra.role_key
left join public.admins a on a.user_id = ra.user_id
where ra.revoked_at is null
group by ra.user_id;

comment on view public.v_staff_directory is
  'Staff roster, one row per account, with every role held and the base role.';

commit;
