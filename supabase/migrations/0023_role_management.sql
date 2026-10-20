begin;

/*
 * 0023 — Super Admin role tier management.
 *
 * WHY A DEDICATED AUDIT TABLE
 * ---------------------------
 * `role_switch_audit` records a user changing their OWN active context, and its
 * `event` CHECK constraint is scoped to switch events. An administrative grant
 * is a different act with a different actor/target pair, so folding it in would
 * mean widening that constraint and making "who did what to whom" ambiguous.
 *
 * INVARIANTS LIVE IN THE DATABASE, NOT THE SERVER ACTION
 * ------------------------------------------------------
 * A Server Action is one caller among several; the RPC is the boundary that
 * cannot be bypassed. Every invariant below is enforced here:
 *
 *   1. Only rank >= 120 may mutate roles (raises 42501).
 *   2. A user must always retain at least one role.
 *   3. The last remaining SUPER_ADMIN cannot be stripped of that role.
 *   4. Every mutation is audited, append-only.
 */

-- ── 1. Audit ────────────────────────────────────────────────────────────────
create table if not exists public.role_management_audit (
  id             bigserial primary key,
  actor_user_id  uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  action         text not null check (action in ('GRANT', 'REVOKE', 'SET_DEFAULT')),
  role_key       text not null references public.roles(key) on delete restrict,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists role_management_audit_target_idx
  on public.role_management_audit (target_user_id, created_at desc);

alter table public.role_management_audit enable row level security;

drop policy if exists role_management_audit_read on public.role_management_audit;
create policy role_management_audit_read on public.role_management_audit
  for select to authenticated
  using (private.has_role_rank(120));

drop trigger if exists trg_role_management_audit_immutable on public.role_management_audit;
create trigger trg_role_management_audit_immutable
  before update or delete on public.role_management_audit
  for each row execute function private.reject_audit_mutation();

-- ── 2. Self-grant guard: allow SUPER_ADMIN self-management ──────────────────
/*
 * The original guard blocked ALL self-grants, which was correct while role
 * management did not exist: it stopped a lower role from escalating itself.
 *
 * Now that only SUPER_ADMIN can grant at all, blocking self-grant adds no
 * security — a SUPER_ADMIN can already grant themselves anything through
 * another account — while it makes self-management incoherent. The guard is
 * narrowed to "nobody below SUPER_ADMIN may grant themselves a role", which is
 * the property it was actually protecting.
 */
create or replace function private.prevent_self_role_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id = (select auth.uid())
     and not private.has_role_rank(120) then
    raise exception 'Self role escalation is not permitted'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ── 3. Guard helper: is the actor allowed to manage roles? ──────────────────
create or replace function private.assert_role_manager()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if not private.has_role_rank(120) then
    raise exception 'Only SUPER_ADMIN may manage roles'
      using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function private.assert_role_manager() from public, anon;
grant execute on function private.assert_role_manager() to authenticated, service_role;

-- ── 4. Grant a role ─────────────────────────────────────────────────────────
create or replace function public.grant_user_role(
  p_target_user uuid,
  p_role_key    text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor      uuid := (select auth.uid());
  v_has_any    boolean;
  v_role_rank  smallint;
begin
  perform private.assert_role_manager();

  select r.rank into v_role_rank from public.roles r where r.key = p_role_key;
  if v_role_rank is null then
    raise exception 'Unknown role %', p_role_key using errcode = 'check_violation';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_target_user) then
    raise exception 'Target user does not exist' using errcode = 'no_data_found';
  end if;

  select exists (
    select 1 from public.role_assignments ra
     where ra.user_id = p_target_user and ra.revoked_at is null
  ) into v_has_any;

  /*
   * The first role an account receives becomes its base role. Without this the
   * account would resolve to nothing and be unable to reach any surface.
   */
  insert into public.role_assignments (user_id, role_key, granted_by, is_default)
  values (p_target_user, p_role_key, v_actor, not v_has_any)
  on conflict (user_id, role_key) do update
    set revoked_at = null,
        granted_by = v_actor,
        granted_at = now();

  insert into public.role_management_audit
    (actor_user_id, target_user_id, action, role_key, detail)
  values (v_actor, p_target_user, 'GRANT', p_role_key,
          jsonb_build_object('was_first_role', not v_has_any));
end $$;

revoke all on function public.grant_user_role(uuid, text) from public, anon;
grant execute on function public.grant_user_role(uuid, text) to authenticated, service_role;

-- ── 5. Revoke a role ────────────────────────────────────────────────────────
create or replace function public.revoke_user_role(
  p_target_user uuid,
  p_role_key    text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor            uuid := (select auth.uid());
  v_remaining        int;
  v_super_admin_cnt  int;
  v_was_default      boolean;
  v_next_default     text;
begin
  perform private.assert_role_manager();

  select ra.is_default into v_was_default
    from public.role_assignments ra
   where ra.user_id = p_target_user
     and ra.role_key = p_role_key
     and ra.revoked_at is null;

  if not found then
    raise exception 'User does not hold role %', p_role_key using errcode = 'no_data_found';
  end if;

  select count(*)::int into v_remaining
    from public.role_assignments ra
   where ra.user_id = p_target_user and ra.revoked_at is null;

  /*
   * Invariant: never remove the last SUPER_ADMIN.
   *
   * Checked BEFORE the zero-role invariant so the more specific, more
   * actionable message wins. Both fire for the same operation when the last
   * super admin holds only that role, and "you cannot remove the last
   * SUPER_ADMIN" tells the operator what to do; "a user must retain at least
   * one role" does not.
   *
   * Counted ACROSS the system, not per user: two accounts may both hold it, and
   * removing one is safe. Removing the final one locks every operator out of
   * role management permanently, with no in-app recovery path.
   */
  if p_role_key = 'SUPER_ADMIN' then
    select count(distinct ra.user_id)::int into v_super_admin_cnt
      from public.role_assignments ra
     where ra.role_key = 'SUPER_ADMIN' and ra.revoked_at is null;

    if v_super_admin_cnt <= 1 then
      raise exception 'Cannot remove the last SUPER_ADMIN'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Invariant: never leave an account with zero roles.
  if v_remaining <= 1 then
    raise exception 'A user must retain at least one role'
      using errcode = 'check_violation';
  end if;

  delete from public.role_assignments
   where user_id = p_target_user and role_key = p_role_key;

  /*
   * If the removed role was the base role, promote the highest remaining role
   * so the account still resolves deterministically.
   */
  if coalesce(v_was_default, false) then
    select ra.role_key into v_next_default
      from public.role_assignments ra
      join public.roles r on r.key = ra.role_key
     where ra.user_id = p_target_user and ra.revoked_at is null
     order by r.rank desc
     limit 1;

    update public.role_assignments
       set is_default = true
     where user_id = p_target_user and role_key = v_next_default;
  end if;

  insert into public.role_management_audit
    (actor_user_id, target_user_id, action, role_key, detail)
  values (v_actor, p_target_user, 'REVOKE', p_role_key,
          jsonb_build_object('was_default', coalesce(v_was_default, false),
                             'new_default', v_next_default));
end $$;

revoke all on function public.revoke_user_role(uuid, text) from public, anon;
grant execute on function public.revoke_user_role(uuid, text) to authenticated, service_role;

-- ── 6. Set the base role ────────────────────────────────────────────────────
create or replace function public.set_default_user_role(
  p_target_user uuid,
  p_role_key    text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  perform private.assert_role_manager();

  if not exists (
    select 1 from public.role_assignments ra
     where ra.user_id = p_target_user and ra.role_key = p_role_key
       and ra.revoked_at is null
  ) then
    raise exception 'User does not hold role %', p_role_key using errcode = 'no_data_found';
  end if;

  update public.role_assignments
     set is_default = (role_key = p_role_key)
   where user_id = p_target_user and revoked_at is null;

  insert into public.role_management_audit
    (actor_user_id, target_user_id, action, role_key, detail)
  values (v_actor, p_target_user, 'SET_DEFAULT', p_role_key, '{}'::jsonb);
end $$;

revoke all on function public.set_default_user_role(uuid, text) from public, anon;
grant execute on function public.set_default_user_role(uuid, text) to authenticated, service_role;

-- ── 7. Roster read model ────────────────────────────────────────────────────
/*
 * One row per account with every role held, its base role, and account status.
 *
 * Implemented as an RPC rather than a view so the email / confirmation /
 * last-sign-in columns can come from `auth.users`, which is not exposed to
 * PostgREST. Gated on rank 120 inside the function, so an unauthorised caller
 * gets 42501 rather than an empty list — an empty list would be indistinguishable
 * from "there are no users" and hide the authorization failure.
 */
create or replace function public.list_users_with_roles()
returns table (
  user_id         uuid,
  email           text,
  full_name       text,
  display_name    text,
  roles           text[],
  base_role       text,
  max_rank        smallint,
  email_confirmed boolean,
  last_sign_in_at timestamptz,
  created_at      timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_role_manager();

  return query
  select
    u.id,
    u.email::text,
    p.full_name,
    p.display_name,
    coalesce(
      array_agg(ra.role_key order by r.rank desc) filter (where ra.role_key is not null),
      '{}'::text[]
    ),
    (array_agg(ra.role_key order by r.rank desc)
       filter (where ra.is_default and ra.role_key is not null))[1],
    coalesce(max(r.rank), 0::smallint),
    (u.email_confirmed_at is not null),
    u.last_sign_in_at,
    u.created_at
  from auth.users u
  left join public.user_profiles p on p.user_id = u.id
  left join public.role_assignments ra
         on ra.user_id = u.id and ra.revoked_at is null
  left join public.roles r on r.key = ra.role_key
  group by u.id, u.email, p.full_name, p.display_name,
           u.email_confirmed_at, u.last_sign_in_at, u.created_at
  order by coalesce(max(r.rank), 0) desc, u.email;
end $$;

revoke all on function public.list_users_with_roles() from public, anon;
grant execute on function public.list_users_with_roles() to authenticated, service_role;

commit;
