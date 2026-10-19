-- ============================================================================
-- ELTS STUDIO OS — RBAC CORE
-- Migration: 0002_rbac_core
-- ============================================================================
-- DESIGN CONTRACT
-- ---------------
-- 1. ADDITIVE ONLY. Nothing is dropped. No existing row is deleted or rewritten.
-- 2. BACKWARD COMPATIBLE. `public.admins` is retained unchanged and every
--    existing member is back-filled to SUPER_ADMIN, so `private.is_admin()`
--    continues to authorise them. Application code keeps working during the
--    transition.
-- 3. IDEMPOTENT. Safe to re-run: every statement is guarded.
-- 4. TRANSACTIONAL. Single BEGIN/COMMIT — no partial application state.
-- 5. FAIL-SAFE ORDERING. Roles and permissions are seeded BEFORE assignments
--    reference them, and helpers are created BEFORE any policy uses them.
--
-- ROLE MODEL
-- ----------
--   SUPER_ADMIN 120  Technical authority: audit logs, telemetry, migrations,
--                    integrations, feature flags, RBAC provisioning.
--   FOUNDER     100  Business governance: P&L, cash ledger, waterfall splits,
--                    expense approval. Deliberately free of technical tooling.
--   ADMIN        80  Operations: dispatch, scheduling, logistics, projects,
--                    and client invoicing (create/view/issue).
--   WORKER       60  Full-time creative: task execution, editor queue, uploads.
--   FREELANCER   30  Field crew, magic-link only. NOT an auth.users identity.
--   CLIENT       10  Gallery/PIN portal. NOT an auth.users identity.
--
-- FINANCIAL AUTHORITY (deliberate, see risk note below)
-- ----------------------------------------------------
--   ADMIN may CREATE and ISSUE invoices, but may NOT confirm payment, void an
--   invoice, or move money. Separating issuance from settlement avoids a single
--   role both raising a charge and marking it paid.
-- ============================================================================

begin;

-- ── 1. Roles ────────────────────────────────────────────────────────────────
create table if not exists public.roles (
  key         text primary key,
  label       text not null,
  rank        smallint not null unique,
  description text,
  is_staff    boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.roles (key, label, rank, description, is_staff) values
  ('SUPER_ADMIN','Super Admin',           120, 'Technical authority: system, migrations, RBAC, integrations.', true),
  ('FOUNDER',    'Founder / Studio Head', 100, 'Business governance: P&L, treasury, splits, approvals.',       true),
  ('ADMIN',      'Operations Lead',        80, 'Dispatch, scheduling, logistics, projects, invoicing.',        true),
  ('WORKER',     'Full-Time Creative',     60, 'Assigned task execution, editor queue, uploads.',               true),
  ('FREELANCER', 'Field Crew',             30, 'Magic-link call sheets, offers, fee slips. Not a login.',       false),
  ('CLIENT',     'Client',                 10, 'Gallery and invoicing portal. Not a login.',                    false)
on conflict (key) do update
  set label       = excluded.label,
      rank        = excluded.rank,
      description = excluded.description,
      is_staff    = excluded.is_staff;

-- ── 2. Permissions ──────────────────────────────────────────────────────────
create table if not exists public.permissions (
  key         text primary key,
  description text not null,
  domain      text not null
);

insert into public.permissions (key, description, domain) values
  -- Projects & operations
  ('project.read',            'View projects and their workspace',            'operations'),
  ('project.write',           'Create and edit projects',                     'operations'),
  ('project.delete',          'Delete or archive a project',                  'operations'),
  ('crew.read',               'View crew directory and assignments',          'operations'),
  ('crew.write',              'Assign crew and set fees',                     'operations'),
  ('gear.read',               'View inventory catalogue',                     'operations'),
  ('gear.write',              'Create and edit inventory assets',             'operations'),
  ('gear.delete',             'Delete an inventory asset',                    'operations'),
  ('calendar.read',           'View the operations calendar',                 'operations'),
  ('calendar.write',          'Create and edit calendar events',              'operations'),
  ('task.read',               'View editor queue tasks',                      'operations'),
  ('task.write',              'Update assigned editor tasks',                 'operations'),
  -- Client-facing
  ('customer.read',           'View customer records',                        'clients'),
  ('customer.write',          'Create and edit customer records',             'clients'),
  ('customer.archive',        'Archive a customer',                           'clients'),
  ('gallery.manage',          'Manage gallery access, PINs and expiry',       'clients'),
  -- Finance
  ('invoice.read',            'View commercial invoices',                     'finance'),
  ('invoice.issue',           'Create and issue a client invoice',            'finance'),
  ('invoice.settle',          'Confirm payment, record receipts, void',       'finance'),
  ('expense.read',            'View project expenses',                        'finance'),
  ('expense.write',           'Record a project expense',                     'finance'),
  ('expense.approve',         'Approve a submitted expense',                  'finance'),
  ('ledger.read',             'View the cash ledger',                         'finance'),
  ('split.read',              'View waterfall profit splits',                 'finance'),
  ('split.approve',           'Approve a waterfall profit split',             'finance'),
  ('payout.release',          'Release a payout',                             'finance'),
  -- System (technical)
  ('system.settings',         'Change studio/system settings',               'system'),
  ('system.rbac',             'Grant, revoke and override roles',            'system'),
  ('system.audit',            'Read technical audit logs',                    'system'),
  ('system.telemetry',        'View system health and telemetry',             'system'),
  ('system.integration',      'Configure API keys, webhooks, integrations',   'system'),
  ('system.migration',        'Run database migrations',                      'system'),
  ('system.flags',            'Toggle feature flags and maintenance mode',    'system')
on conflict (key) do update
  set description = excluded.description,
      domain      = excluded.domain;

-- ── 3. Role → permission grants ─────────────────────────────────────────────
create table if not exists public.role_permissions (
  role_key       text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

-- Rebuild the grants from a single declaration so re-runs converge.
delete from public.role_permissions;

insert into public.role_permissions (role_key, permission_key)
select r.key, p.key
from public.roles r
join lateral (
  select key from public.permissions
) p on true
where
  -- SUPER_ADMIN: everything. The only role with system.* authority.
  (r.key = 'SUPER_ADMIN')
  -- FOUNDER: full business + finance + read-only operations. No system.*.
  or (r.key = 'FOUNDER' and p.key in (
        'project.read','project.write','crew.read','gear.read','calendar.read',
        'task.read','customer.read','customer.write','customer.archive','gallery.manage',
        'invoice.read','invoice.issue','invoice.settle',
        'expense.read','expense.write','expense.approve',
        'ledger.read','split.read','split.approve','payout.release'
      ))
  -- ADMIN: operations + invoicing, but NOT settlement, ledger or splits.
  or (r.key = 'ADMIN' and p.key in (
        'project.read','project.write','crew.read','crew.write',
        'gear.read','gear.write','calendar.read','calendar.write',
        'task.read','customer.read','customer.write','gallery.manage',
        'invoice.read','invoice.issue','expense.read','expense.write'
      ))
  -- WORKER: execute assigned work. No finance, no client records.
  or (r.key = 'WORKER' and p.key in (
        'project.read','crew.read','gear.read','calendar.read',
        'task.read','task.write'
      ))
  -- FREELANCER / CLIENT: no PostgREST grants at all. They operate through
  -- SECURITY DEFINER RPCs scoped to a token or gallery session.
  ;

-- ── 4. Staff role assignments ───────────────────────────────────────────────
create table if not exists public.role_assignments (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role_key   text not null references public.roles(key) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at > granted_at)
);

create index if not exists role_assignments_role_idx
  on public.role_assignments (role_key) where revoked_at is null;

comment on table public.role_assignments is
  'Staff identity → role. FREELANCER and CLIENT are intentionally absent: they authenticate by token/session, not auth.users.';

-- Back-fill: every existing admin becomes SUPER_ADMIN so no current member
-- loses access when the policies in 0003 replace the blunt is_admin() gate.
insert into public.role_assignments (user_id, role_key)
select user_id, 'SUPER_ADMIN' from public.admins
on conflict (user_id) do nothing;

-- ── 5. Authorization helpers ────────────────────────────────────────────────
-- SECURITY DEFINER + empty search_path: these are called from RLS policies, so
-- they must not recurse through the policies on the tables they read.
--
-- LEGACY FALLBACK
-- ---------------
-- A member present in `public.admins` but absent from `role_assignments` is
-- treated as ADMIN (rank 80). This preserves the pre-RBAC authorization model
-- for every existing member during the transition, so deploying 0002/0003
-- cannot lock anyone out. New members should be granted through
-- `role_assignments`; remove this fallback once the roster is fully migrated
-- (see docs/rbac-migration.md).
create or replace function private.legacy_admin_rank() returns smallint
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.admins where user_id = (select auth.uid()))
      then 80::smallint
    else 0::smallint
  end;
$$;

create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select a.role_key
      from public.role_assignments a
      where a.user_id = (select auth.uid())
        and a.revoked_at is null
      limit 1
    ),
    -- Legacy member with no explicit assignment.
    case when private.legacy_admin_rank() > 0 then 'ADMIN' else null end
  );
$$;

/*
 * An explicit assignment SUPERSEDES the legacy fallback — it does not combine
 * with it.
 *
 * The first version used `greatest(assigned_rank, legacy_rank)`. That was a
 * privilege-escalation bug: a WORKER (60) who also happened to be listed in
 * `public.admins` resolved to 80, silently gaining ADMIN access because the
 * legacy shim was maxed in rather than treated as a fallback.
 *
 * Correct precedence:
 *   role_assignments row present  → that rank, exactly
 *   no row, but in public.admins  → 80 (transitional compatibility)
 *   neither                       → 0
 */
create or replace function private.current_role_rank() returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (
      select r.rank
      from public.role_assignments a
      inner join public.roles r on r.key = a.role_key
      where a.user_id = (select auth.uid())
        and a.revoked_at is null
      limit 1
    )::smallint,
    private.legacy_admin_rank()
  );
$$;
-- Rank-based gate: has_role_rank(80) means "ADMIN or higher".
--
-- The parameter is `integer`, not `smallint`: in an RLS policy the literal
-- `has_role_rank(80)` is parsed as an integer, so a smallint signature would
-- never resolve and the policy would fail to create.
create or replace function private.has_role_rank(p_min integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_role_rank() >= p_min;
$$;
create or replace function private.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.role_assignments a
    join public.role_permissions rp on rp.role_key = a.role_key
    where a.user_id = (select auth.uid())
      and a.revoked_at is null
      and rp.permission_key = p_key
  );
$$;

revoke all on function
  private.current_role(), private.current_role_rank(),
  private.has_role_rank(integer), private.has_permission(text)
  from public, anon;
grant execute on function
  private.current_role(), private.current_role_rank(),
  private.has_role_rank(integer), private.has_permission(text)
  to authenticated, service_role;

-- ── 6. RLS on the RBAC tables themselves ────────────────────────────────────
alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;

-- Any authenticated staff member may read the role/permission catalogue
-- (the admin shell renders labels from it).
drop policy if exists roles_read_staff on public.roles;
create policy roles_read_staff on public.roles
  for select to authenticated using (private.has_role_rank(30));

drop policy if exists permissions_read_staff on public.permissions;
create policy permissions_read_staff on public.permissions
  for select to authenticated using (private.has_role_rank(30));

drop policy if exists role_permissions_read_staff on public.role_permissions;
create policy role_permissions_read_staff on public.role_permissions
  for select to authenticated using (private.has_role_rank(30));

-- A member may always read their own assignment (bootstrap: this must work
-- before any role exists, hence the direct auth.uid() comparison).
drop policy if exists role_assignments_read_self on public.role_assignments;
create policy role_assignments_read_self on public.role_assignments
  for select to authenticated using (user_id = (select auth.uid()));

-- Only SUPER_ADMIN may grant, change or revoke roles.
drop policy if exists role_assignments_super_admin_write on public.role_assignments;
create policy role_assignments_super_admin_write on public.role_assignments
  for all to authenticated
  using (private.has_role_rank(120))
  with check (private.has_role_rank(120));

-- ── 7. Guard: no self-escalation ────────────────────────────────────────────
-- A SUPER_ADMIN may grant any role; nobody may grant a role to themselves
-- (prevents a compromised FOUNDER account from minting a SUPER_ADMIN, and
-- keeps every elevation attributable to a second actor).
create or replace function private.prevent_self_role_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id = (select auth.uid()) and new.role_key <> coalesce(old.role_key, '') then
    raise exception 'Self role escalation is not permitted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_grant on public.role_assignments;
create trigger trg_prevent_self_role_grant
  before insert or update on public.role_assignments
  for each row execute function private.prevent_self_role_grant();

-- ── 8. Read-only view for the admin Users screen ────────────────────────────
create or replace view public.v_staff_directory as
select
  ra.user_id,
  ra.role_key,
  r.label        as role_label,
  r.rank         as role_rank,
  a.display_name,
  ra.granted_at,
  ra.revoked_at
from public.role_assignments ra
join public.roles r on r.key = ra.role_key
left join public.admins a on a.user_id = ra.user_id
where ra.revoked_at is null;

comment on view public.v_staff_directory is
  'Staff roster with resolved role. Read through the caller''s own RLS context.';

-- ── 9. RPC surface for application guards ───────────────────────────────────
-- `private` is not an exposed schema, so the application cannot call
-- `private.current_role()` directly through PostgREST. These wrappers expose
-- exactly the two answers the guard layer needs, and nothing else.
--
-- Both are SECURITY DEFINER and resolve the actor from auth.uid(), so a caller
-- cannot pass someone else's identity.
create or replace function public.get_caller_role()
returns table (role_key text, role_rank smallint, display_name text)
language sql stable security definer set search_path = '' as $$
  select
    private.current_role()        as role_key,
    private.current_role_rank()   as role_rank,
    (select a.display_name from public.admins a where a.user_id = (select auth.uid()))
                                  as display_name;
$$;

create or replace function public.has_permission_for_caller(p_permission_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_permission_key);
$$;

revoke all on function public.get_caller_role() from public, anon;
revoke all on function public.has_permission_for_caller(text) from public, anon;
grant execute on function public.get_caller_role() to authenticated, service_role;
grant execute on function public.has_permission_for_caller(text) to authenticated, service_role;

comment on function public.get_caller_role() is
  'Resolves the caller''s own role and rank. Used by src/lib/auth/roles.ts.';
comment on function public.has_permission_for_caller(text) is
  'Permission probe for the caller. Used by src/lib/auth/roles.ts.';

commit;
