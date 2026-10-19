-- ============================================================================
-- ELTS STUDIO OS — MODERNIZATION CORE
-- Migration: 0006_modernization_core
-- ============================================================================
-- Contract 1 (db-rbac lane). Seven schema changes, all additive and idempotent.
--
-- IMPORTANT FINDINGS THAT SHAPED THIS FILE
-- ---------------------------------------
-- `editor_tasks.assigned_editor_id` ALREADY EXISTS, but as `text` holding a
-- CREW MEMBER id (a0000…/CRW-xx), not an auth user id. The brief assumed it
-- needed adding as `uuid references auth.users`. Rather than repurpose a column
-- that `admin-users.ts` already reads as a crew id, this migration introduces a
-- separate, correctly-typed link:
--
--     editor_tasks.assigned_user_id uuid references auth.users(id)
--
-- and adds `crew_members.auth_user_id` so a WORKER's login can be tied to their
-- crew record. Without that link a "self-only" policy has nothing to compare to.
--
-- All statements are guarded. Single transaction. No data deletion.
-- ============================================================================

begin;

-- ── 1. Crew re-assignment: revoke instead of delete ─────────────────────────
alter table public.project_crew_assignments
  add column if not exists revoked_at timestamptz;

comment on column public.project_crew_assignments.revoked_at is
  'Set when an assignment is cancelled or reassigned. History is preserved; fee rows are no longer authoritative.';

-- Drop the blanket unique so a declined crew member can be re-offered later.
alter table public.project_crew_assignments
  drop constraint if exists project_crew_assignments_project_id_crew_member_id_key;

-- One ACTIVE assignment per (project, crew). Revoked rows accumulate as history.
create unique index if not exists pca_active_unique
  on public.project_crew_assignments (project_id, crew_member_id)
  where revoked_at is null;

create index if not exists pca_active_idx
  on public.project_crew_assignments (project_id)
  where revoked_at is null;

-- ── 2. Crew → auth user link ────────────────────────────────────────────────
-- A WORKER logs in with an auth.users identity; their crew record is separate.
-- This column is what makes an assignment-scoped policy possible.
alter table public.crew_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists crew_members_auth_user_unique
  on public.crew_members (auth_user_id)
  where auth_user_id is not null;

comment on column public.crew_members.auth_user_id is
  'Optional link to the staff login for this crew member. Required for self-scoped policies.';

-- ── 3. Editor task assignment (properly typed) ──────────────────────────────
-- Keep the legacy text column; add the auth-typed one the policy needs.
alter table public.editor_tasks
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null;

create index if not exists editor_tasks_assigned_user_idx
  on public.editor_tasks (assigned_user_id);

comment on column public.editor_tasks.assigned_user_id is
  'Auth identity of the editor. WORKER may only mutate rows where this equals auth.uid().';

-- ── 4. Selection deadline ───────────────────────────────────────────────────
alter table public.projects
  add column if not exists selection_deadline timestamptz;

-- Backfill: 14 days after the shoot for projects that already have a shoot date.
update public.projects
   set selection_deadline = (shoot_date + interval '14 days')
 where selection_deadline is null
   and shoot_date is not null;

comment on column public.projects.selection_deadline is
  'Deadline for the client to lock photo selections. Defaults to shoot_date + 14 days.';

-- Keep the default maintained for future rows.
create or replace function private.set_selection_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.selection_deadline is null and new.shoot_date is not null then
    new.selection_deadline := new.shoot_date + interval '14 days';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_selection_deadline on public.projects;
create trigger trg_set_selection_deadline
  before insert or update of shoot_date, selection_deadline on public.projects
  for each row execute function private.set_selection_deadline();

-- ── 5. Reminder audit log ───────────────────────────────────────────────────
create table if not exists public.client_reminders_log (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete set null,
  invoice_id      uuid references public.project_invoices(id) on delete set null,
  reminder_kind   text not null check (reminder_kind in (
                    'T_MINUS_7_PREP','T_MINUS_1_CALLSHEET','SHOOT_DAY_ONSITE',
                    'GALLERY_READY','PAYMENT_DP','PAYMENT_FINAL','PAYMENT_OVERDUE',
                    'SELECTION_REMINDER')),
  target_phone    text not null check (length(target_phone) between 8 and 32),
  channel         text not null default 'WHATSAPP_DEEPLINK'
                    check (channel in ('WHATSAPP_DEEPLINK','MANUAL')),
  dispatched_by   uuid references auth.users(id) on delete set null,
  dispatched_at   timestamptz not null default now(),
  -- Snapshot of the exact text the operator saw and confirmed. Templates change;
  -- this is the evidence of what was actually sent.
  body_snapshot   text not null
);

create index if not exists crl_project_idx on public.client_reminders_log (project_id, dispatched_at desc);
create index if not exists crl_kind_idx    on public.client_reminders_log (reminder_kind, dispatched_at desc);

alter table public.client_reminders_log enable row level security;

drop policy if exists crl_read on public.client_reminders_log;
create policy crl_read on public.client_reminders_log
  for select to authenticated using (private.has_role_rank(80));

drop policy if exists crl_insert on public.client_reminders_log;
create policy crl_insert on public.client_reminders_log
  for insert to authenticated with check (private.has_role_rank(80));

-- This project runs `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO
-- authenticated` (from the Supabase bootstrap), so a newly created table
-- arrives with SELECT/INSERT/UPDATE/DELETE/TRUNCATE already granted. Adding
-- INSERT and SELECT therefore changes nothing on its own: the append-only
-- guarantee has to be enforced by REVOKING the rest.
--
-- Revoking is deliberately narrow — this table only. A table created with an
-- unwanted default is a local defect; changing the project-wide default
-- privileges would silently alter every other table.
revoke all on public.client_reminders_log from authenticated;
grant select, insert on public.client_reminders_log to authenticated;
grant all on public.client_reminders_log to service_role;

-- Belt and braces. RLS already denies UPDATE/DELETE because no policy grants
-- them, but a future policy added carelessly must not be able to reopen an
-- audit log. Append-only is now guaranteed at the privilege layer too.
create or replace function private.client_reminders_log_append_only()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'client_reminders_log is append-only: UPDATE is not permitted'
      using errcode = '42501';
  end if;
  raise exception 'client_reminders_log is append-only: DELETE is not permitted'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_crl_append_only on public.client_reminders_log;
create trigger trg_crl_append_only
  before update or delete on public.client_reminders_log
  for each row execute function private.client_reminders_log_append_only();

-- ── 6. Inventory: WORKER may report condition, nothing else ─────────────────
alter table public.inventory_assets
  add column if not exists condition_reported_by uuid references auth.users(id) on delete set null,
  add column if not exists condition_reported_at timestamptz;

-- Row-level: a WORKER (rank >= 60) may UPDATE a row. Column-level privilege is
-- granted separately below so they cannot rewrite prices or ownership. RLS alone
-- cannot restrict COLUMNS; both mechanisms are required.
drop policy if exists inventory_worker_condition on public.inventory_assets;
create policy inventory_worker_condition on public.inventory_assets
  for update to authenticated
  using (private.has_role_rank(60))
  with check (private.has_role_rank(60));

-- ── 7. Invoice read/write split ─────────────────────────────────────────────
-- The 0003 generator created a single *_rbac_write policy at rank 100 and a
-- *_rbac_read at rank 100. ADMIN (80) must read invoices but never write them.
do $$
begin
  execute 'drop policy if exists project_invoices_rbac_read on public.project_invoices';
  execute $f$
    create policy project_invoices_rbac_read on public.project_invoices
      for select to authenticated using (private.has_role_rank(80))
  $f$;

  execute 'drop policy if exists project_invoices_rbac_write on public.project_invoices';
  execute $f$
    create policy project_invoices_rbac_write on public.project_invoices
      for all to authenticated
      using (private.has_role_rank(100))
      with check (private.has_role_rank(100))
  $f$;

  -- Line items are a jsonb column, not a table, so reading the row is enough.
  -- Receipts stay FOUNDER-only (settlement authority).
  execute 'drop policy if exists invoice_payment_receipts_rbac_read on public.invoice_payment_receipts';
  execute $f$
    create policy invoice_payment_receipts_rbac_read on public.invoice_payment_receipts
      for select to authenticated using (private.has_role_rank(100))
  $f$;
end $$;

-- ── 8. Project status state machine ─────────────────────────────────────────
-- Enforced in the DATABASE so no code path can bypass it. Allowed edges:
--   draft -> editing -> ready -> archived
--   editing <-> draft, ready <-> editing   (backwards corrections)
--   anything -> expired                    (time-based, set by the system)
--   archived -> ready                      (explicit re-open)
create or replace function private.enforce_project_status_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case
    when old.status = 'draft'    and new.status in ('editing','expired')            then true
    when old.status = 'editing'  and new.status in ('draft','ready','expired')      then true
    when old.status = 'ready'    and new.status in ('editing','archived','expired') then true
    when old.status = 'archived' and new.status in ('ready')                        then true
    when old.status = 'expired'  and new.status in ('archived')                     then true
    else false
  end;

  if not allowed then
    raise exception 'Invalid project status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_project_status_transition on public.projects;
create trigger trg_project_status_transition
  before update of status on public.projects
  for each row execute function private.enforce_project_status_transition();

-- Column-level privilege. Supabase grants UPDATE on all columns to
-- `authenticated` by default; revoke the broad grant and re-issue only the
-- columns a WORKER is allowed to touch. RLS permits the row, this permits the
-- column — both are needed.
revoke update on public.inventory_assets from authenticated;
grant update (condition_status, notes, condition_reported_by, condition_reported_at, updated_at)
  on public.inventory_assets to authenticated;

-- ── 8. Editor tasks: WORKER self-update ────────────────────────────────────
drop policy if exists editor_tasks_worker_self on public.editor_tasks;
create policy editor_tasks_worker_self on public.editor_tasks
  for update to authenticated
  using (
    private.has_role_rank(100)
    or (
      private.has_role_rank(60)
      and assigned_user_id is not null
      and assigned_user_id = (select auth.uid())
    )
  )
  with check (
    private.has_role_rank(100)
    or assigned_user_id = (select auth.uid())
  );

-- ── 9. Crew assignment self-scope (FREELANCER consent path stays RPC-only) ──
-- A WORKER may read assignments for projects they can read; mutation remains
-- with ADMIN+. This policy is deliberately read-only to avoid duplicating the
-- magic-token RPC surface.
drop policy if exists pca_worker_read on public.project_crew_assignments;
create policy pca_worker_read on public.project_crew_assignments
  for select to authenticated using (private.has_role_rank(60));

commit;
