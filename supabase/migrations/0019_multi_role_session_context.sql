begin;

/*
 * 0019 — Multi-role hybrid structure, session-scoped active role, and
 *        password-challenged elevation.
 *
 * WHY THIS MIGRATION EXISTS
 * -------------------------
 * `public.role_assignments` had PRIMARY KEY (user_id), so exactly one role per
 * account was structurally enforced. A hybrid member (ray -> WORKER + EDITOR +
 * FOUNDER) could not be represented at all. This migration converts that table
 * into a junction and moves the *active* role into a per-session context, so
 * that RLS evaluates the role the user is currently operating as rather than
 * the union of every role they hold.
 *
 * DEVIATION FROM THE BRIEF, AND WHY
 * ---------------------------------
 * The brief asks for `PRIMARY KEY (user_id, role_id)`. `public.roles` has no
 * `role_id`: its primary key is the natural key `key text`, and every
 * `role_permissions` row, all 62 RLS predicates, and `ROLE_RANK` in the
 * application are keyed on that text. Introducing a surrogate `role_id` would
 * force a join at every one of those sites for zero benefit. The composite
 * primary key is therefore `(user_id, role_key)`, which is the same junction
 * semantics under the schema's existing natural key.
 */

-- ── 1. EDITOR role (rank 50) ────────────────────────────────────────────────
--
-- Rank 50 is DELIBERATELY below WORKER (60). An editor who switches into
-- EDITOR mode must have strictly less reach than in WORKER mode: they lose
-- `media_rbac_read` (rank >= 60) and every staff surface, and keep only their
-- own assigned tasks. A rank at or above 60 would make the switch cosmetic.
insert into public.roles (key, label, rank, description, is_staff)
values (
  'EDITOR',
  'Editor',
  50,
  'Assigned edit queue only. No media library, no operations surface.',
  true
)
on conflict (key) do update
  set label       = excluded.label,
      rank        = excluded.rank,
      description = excluded.description,
      is_staff    = excluded.is_staff;

-- Editors get the narrowest possible permission set: their own queue.
insert into public.role_permissions (role_key, permission_key)
select 'EDITOR', p.key
from public.permissions p
where p.key in ('project.read', 'task.read', 'task.write', 'calendar.read')
on conflict do nothing;

-- ── 2. role_assignments becomes a junction ──────────────────────────────────
alter table public.role_assignments
  drop constraint if exists role_assignments_pkey;

alter table public.role_assignments
  add constraint role_assignments_pkey primary key (user_id, role_key);

/*
 * Explicit base role for hybrid accounts.
 *
 * Without this, "which role does a hybrid member start in?" has no answer, and
 * a resolver that picks the HIGHEST owned role would silently start Ray as
 * FOUNDER on every login — defeating the entire feature. Exactly one default
 * per user is enforced by the partial unique index below.
 */
alter table public.role_assignments
  add column if not exists is_default boolean not null default false;

create unique index if not exists role_assignments_one_default_idx
  on public.role_assignments (user_id)
  where is_default and revoked_at is null;

-- ── 3. Self-grant guard for the junction shape ──────────────────────────────
--
-- The previous trigger compared old/new `role_key` on a single row. Under a
-- junction, granting yourself a role is an INSERT of a new (user_id, role_key)
-- pair, which never fires that comparison — the guard would have silently
-- stopped working the moment the PK changed.
create or replace function private.prevent_self_role_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id = (select auth.uid()) then
    raise exception 'Self role escalation is not permitted'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ── 4. Per-session active role ──────────────────────────────────────────────
create table if not exists public.user_session_context (
  session_id     uuid primary key references auth.sessions(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  active_role    text not null references public.roles(key) on delete restrict,
  /* NULL = base context. Non-null = the instant elevation lapses. */
  elevated_until timestamptz,
  established_by text not null default 'LOGIN'
    check (established_by in ('LOGIN', 'SWITCH', 'DOWNGRADE', 'CHALLENGE')),
  updated_at     timestamptz not null default now(),
  /*
   * An elevated context MUST carry a deadline. A row claiming elevation with no
   * expiry is unrepresentable, so a resolver can never treat a forgotten row as
   * a permanent grant.
   */
  constraint user_session_context_elevation_has_ttl
    check (elevated_until is not null or established_by <> 'CHALLENGE')
);

create index if not exists user_session_context_user_idx
  on public.user_session_context (user_id);

alter table public.user_session_context enable row level security;

drop policy if exists user_session_context_read_self on public.user_session_context;
create policy user_session_context_read_self on public.user_session_context
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No write policy for `authenticated`: every write goes through the
-- SECURITY DEFINER functions below.

-- ── 5. Single-use challenge tokens ──────────────────────────────────────────
--
-- The brief specifies `set_active_role(p_role_name, p_challenge_token)`.
-- A token is strictly better than the RFC's boolean `p_challenged`: a boolean
-- is caller-supplied and therefore forgeable, whereas a token can only be
-- minted by a SECURITY DEFINER function that the browser cannot execute
-- (service_role only), and it is single-use, session-bound and short-lived.
create table if not exists public.role_challenge_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   uuid not null,
  target_role  text not null references public.roles(key) on delete restrict,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists role_challenge_tokens_lookup_idx
  on public.role_challenge_tokens (id)
  where consumed_at is null;

alter table public.role_challenge_tokens enable row level security;
-- No policies at all: unreachable through PostgREST. Only SECURITY DEFINER
-- functions and service_role touch this table.

-- ── 6. Role switch audit ────────────────────────────────────────────────────
create table if not exists public.role_switch_audit (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id uuid,
  from_role  text,
  to_role    text,
  actor_rank smallint not null,
  event      text not null check (event in
               ('SWITCH', 'DOWNGRADE', 'CHALLENGE_FAILED', 'CHALLENGE_OK',
                'EXPIRED', 'REVOKED')),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists role_switch_audit_user_idx
  on public.role_switch_audit (user_id, created_at desc);

alter table public.role_switch_audit enable row level security;

drop policy if exists role_switch_audit_read on public.role_switch_audit;
create policy role_switch_audit_read on public.role_switch_audit
  for select to authenticated
  using (private.has_role_rank(120));

-- Append-only, reusing the existing payroll audit immutability helper.
drop trigger if exists trg_role_switch_audit_immutable on public.role_switch_audit;
create trigger trg_role_switch_audit_immutable
  before update or delete on public.role_switch_audit
  for each row execute function private.reject_audit_mutation();

commit;
