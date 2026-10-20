-- ============================================================================
-- ELTS STUDIO OS — PAYROLL FOUNDATION: IDENTITY, EQUITY, RATES
-- Migration: 0012_payroll_identity_and_equity
-- ============================================================================
-- Phase 1 of the payroll pivot. Sets up the three things every later phase
-- depends on:
--
--   1. `crew_members.auth_user_id` becomes resolvable, so `auth.uid()` can scope
--      a freelancer's own earnings. The column already existed but was NULL on
--      every row, which meant any `auth.uid()` filter matched nothing.
--   2. `partner_accounts` — explicit persons with integer basis points. The
--      retired waterfall stored float percentages (reserve_pct numeric, 50:50
--      hardcoded in JS and contradicted by the stored 65/35 data). Equity is
--      now integer bp summing to exactly 10000.
--   3. `compensation_rates` — a defined base pay for task-based work. Neither
--      `editor_tasks` nor any role table had a rate, so internal payroll had no
--      data source at all.
--
-- Deliberately NOT in this migration: any row for a real person. Equity splits
-- and pay rates are business facts, not schema, so they are seeded separately
-- and only after the founder confirms the split.

begin;

-- ── 1. Crew identity ────────────────────────────────────────────────────────
-- Already present on hosted, added defensively for a clean-room install.
alter table public.crew_members
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

-- One login may map to at most one crew record.
create unique index if not exists crew_members_auth_user_uniq
  on public.crew_members(auth_user_id)
  where auth_user_id is not null;

comment on column public.crew_members.auth_user_id is
  'Login identity for this crew member. NULL means no portal access; set by scripts/link-crew-identities.mjs.';

-- ── 2. Partner equity ───────────────────────────────────────────────────────
create table if not exists public.partner_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete restrict,
  display_name  text not null check (length(display_name) between 2 and 120),
  /**
   * Equity in BASIS POINTS: 10000 = 100.00%.
   *
   * Integer, not numeric percent. The retired model used float math in JS
   * (`remainder / 2` then a hand-rolled EPSILON round), which is why its
   * documented 50:50 split drifted to 65:35 in stored data. Integer bp plus a
   * remainder-to-last-share rule makes the split exact and reconcilable.
   */
  equity_bp     integer not null check (equity_bp between 0 and 10000),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.partner_accounts is
  'Explicit partners receiving the distributable 95%. Active equity_bp must total exactly 10000.';

/**
 * Equity must total exactly 10000 bp among ACTIVE partners.
 *
 * Deferred so a two-statement swap (A 5000 -> 4000, B 5000 -> 6000) can pass
 * through a transient non-10000 state inside one transaction. A non-deferred
 * constraint would reject the intermediate row even though the committed
 * state is valid.
 */
create or replace function private.assert_equity_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_total integer;
  v_active integer;
begin
  select coalesce(sum(equity_bp), 0), count(*)
    into v_total, v_active
    from public.partner_accounts
   where is_active;

  -- Zero active partners is legal (studio before the split is agreed).
  if v_active > 0 and v_total <> 10000 then
    raise exception 'Active partner equity must total 10000 bp, got % across % partner(s)', v_total, v_active
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

revoke all on function private.assert_equity_total() from public, anon, authenticated;
grant execute on function private.assert_equity_total() to service_role;

drop trigger if exists trg_assert_equity_total on public.partner_accounts;
create constraint trigger trg_assert_equity_total
  after insert or update or delete on public.partner_accounts
  deferrable initially deferred
  for each row execute function private.assert_equity_total();

-- ── 3. Task-based rates ─────────────────────────────────────────────────────
create table if not exists public.compensation_rates (
  id           uuid primary key default gen_random_uuid(),
  /**
   * Which population this rate applies to. WORKER covers internal creatives and
   * editors; ADMIN covers salaried operations staff. Externally-paid freelancers
   * are NOT priced here — their pay is `project_crew_assignments.fee_agreed`,
   * which is the single authoritative payable per the approved decision.
   */
  role_key     text not null check (role_key in ('WORKER','ADMIN','FOUNDER','SUPER_ADMIN')),
  task_kind    text not null check (task_kind in (
                 'EDITING','PHOTO_RETOUCH','VIDEO_EDIT','ASSISTANT_EDIT',
                 'SALARY_MONTHLY','OVERTIME_HOURLY')),
  label        text not null check (length(label) between 2 and 120),
  /** Piece rate (per task/deliverable) or monthly salary, in IDR. */
  amount       numeric(14,2) not null check (amount >= 0),
  unit         text not null default 'PIECE' check (unit in ('PIECE','MONTH','HOUR')),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (role_key, task_kind, unit)
);

comment on table public.compensation_rates is
  'Base pay for task/salary work. Excludes freelancers, whose payable is fee_agreed.';

/**
 * Task pay resolution: `editor_tasks` had no rate column, so a task could be
 * assigned but never priced. This adds the nullable override plus a resolver
 * that falls back to `compensation_rates`.
 */
alter table public.editor_tasks
  add column if not exists rate_id uuid references public.compensation_rates(id) on delete set null,
  add column if not exists payable_amount numeric(14,2)
    check (payable_amount is null or payable_amount >= 0),
  add column if not exists payee_user_id uuid references auth.users(id) on delete set null;

create or replace function private.resolve_task_pay(
  p_task_id uuid
) returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
           t.payable_amount,
           r.amount,
           0::numeric
         )
    from public.editor_tasks t
    left join public.compensation_rates r on r.id = t.rate_id and r.is_active
   where t.id = p_task_id;
$$;

revoke all on function private.resolve_task_pay(uuid) from public, anon;
grant execute on function private.resolve_task_pay(uuid) to authenticated, service_role;

-- ── 4. Self-check ──────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='crew_members' and column_name='auth_user_id'
  ) then
    raise exception '0012: crew_members.auth_user_id missing';
  end if;
  if to_regclass('public.partner_accounts') is null then
    raise exception '0012: partner_accounts missing';
  end if;
  if to_regclass('public.compensation_rates') is null then
    raise exception '0012: compensation_rates missing';
  end if;
end $$;

commit;
