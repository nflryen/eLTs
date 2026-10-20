-- ============================================================================
-- ELTS STUDIO OS — ZERO-LEAKAGE EARNINGS TELEMETRY
-- Migration: 0014_earnings_rpc_and_rls
-- ============================================================================
-- Powers the per-role compensation KPI cards.
--
-- THREAT MODEL
-- ------------
-- The application talks to Postgres through a service-role client, so RLS does
-- not run for application traffic (see financial audit, finding H3). Therefore
-- privacy here CANNOT rest on RLS. It rests on these functions:
--
--   • `my_earnings_summary()` takes ZERO arguments. There is no user id or role
--     string to tamper with.
--   • It resolves the caller from `auth.uid()` internally.
--   • It returns only AGGREGATES over the caller's own rows. An aggregate over
--     one person's rows cannot be used to infer another person's pay.
--   • DIVIDEND rows are excluded from personal telemetry entirely: a partner's
--     dividend is an equity event shown in /admin/payroll, never on a personal
--     earnings card.
--
-- RLS is added as a second line for the user-scoped client paths.

begin;

-- ── 1. Personal earnings (zero arguments) ──────────────────────────────────
create or replace function public.my_earnings_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_crew  uuid;
  v_month date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
begin
  if v_uid is null then
    return jsonb_build_object('error', 'UNAUTHENTICATED');
  end if;

  -- A person can be both staff and crew; resolve the crew identity once.
  select id into v_crew
    from public.crew_members
   where auth_user_id = v_uid;

  return (
    with mine as (
      select c.net_amount, c.state, c.earned_on
        from public.compensation_line_items c
       where c.kind <> 'DIVIDEND'                 -- equity events are never personal telemetry
         and c.state <> 'VOID'
         and (
           c.payee_user_id = v_uid
           or (v_crew is not null and c.payee_crew_id = v_crew)
         )
    )
    select jsonb_build_object(
      -- Approved but not yet disbursed.
      'pending_payout', coalesce(sum(net_amount) filter (
        where state in ('APPROVED','READY_FOR_DISBURSEMENT')), 0),
      -- Settled within the active Jakarta calendar month.
      'current_month_payout', coalesce(sum(net_amount) filter (
        where state = 'PAID' and earned_on >= v_month), 0),
      'lifetime_paid', coalesce(sum(net_amount) filter (where state = 'PAID'), 0),
      'pending_count', count(*) filter (where state in ('APPROVED','READY_FOR_DISBURSEMENT')),
      'awaiting_verification_count', count(*) filter (where state = 'PENDING_VERIFICATION'),
      'period_label', to_char(v_month, 'YYYY-MM')
    )
    from mine
  );
end $$;

comment on function public.my_earnings_summary() is
  'Zero-argument, auth.uid()-scoped earnings aggregate. Never returns another person''s figures.';

revoke all on function public.my_earnings_summary() from public, anon;
grant execute on function public.my_earnings_summary() to authenticated;

-- ── 2. Operational payroll rollup for ADMIN (no dividends) ─────────────────
create or replace function public.payroll_operational_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank int := coalesce(private.current_role_rank(), 0);
  v_month date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
begin
  if not private.has_role_rank(80) then
    return jsonb_build_object('error', 'FORBIDDEN');
  end if;

  return (
    with ops as (
      select net_amount, state, earned_on
        from public.compensation_line_items
       where kind in ('CREW_FEE','EDITOR_RATE','SALARY')
         and state <> 'VOID'
    )
    select jsonb_build_object(
      'pending_payout', coalesce(sum(net_amount) filter (
        where state in ('APPROVED','READY_FOR_DISBURSEMENT')), 0),
      'current_month_payout', coalesce(sum(net_amount) filter (
        where state = 'PAID' and earned_on >= v_month), 0),
      'ready_count', count(*) filter (where state = 'READY_FOR_DISBURSEMENT'),
      'awaiting_verification_count', count(*) filter (where state = 'PENDING_VERIFICATION'),
      'can_see_dividends', false,
      'period_label', to_char(v_month, 'YYYY-MM')
    )
    from ops
  );
end $$;

revoke all on function public.payroll_operational_summary() from public, anon;
grant execute on function public.payroll_operational_summary() to authenticated;

-- ── 3. Executive rollup (adds reserve + dividends) ─────────────────────────
create or replace function public.payroll_executive_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
begin
  if not private.has_role_rank(100) then
    -- ADMIN gets the operational view instead of an error, so the UI can
    -- degrade rather than blank.
    return public.payroll_operational_summary();
  end if;

  return (
    with allx as (
      select net_amount, state, earned_on, kind
        from public.compensation_line_items
       where state <> 'VOID'
    )
    select jsonb_build_object(
      'pending_payout', coalesce(sum(net_amount) filter (
        where state in ('APPROVED','READY_FOR_DISBURSEMENT')), 0),
      'current_month_payout', coalesce(sum(net_amount) filter (
        where state = 'PAID' and earned_on >= v_month), 0),
      'dividend_pending', coalesce(sum(net_amount) filter (
        where kind = 'DIVIDEND' and state in ('APPROVED','READY_FOR_DISBURSEMENT')), 0),
      'reserve_accumulated', coalesce((
        select sum(operational_reserve)
          from public.project_profit_snapshots
         where status in ('FINALIZED','LOSS')), 0),
      'ready_count', count(*) filter (where state = 'READY_FOR_DISBURSEMENT'),
      'awaiting_verification_count', count(*) filter (where state = 'PENDING_VERIFICATION'),
      'can_see_dividends', true,
      'period_label', to_char(v_month, 'YYYY-MM')
    )
    from allx
  );
end $$;

revoke all on function public.payroll_executive_summary() from public, anon;
grant execute on function public.payroll_executive_summary() to authenticated;

-- ── 4. RLS: second line of defence ─────────────────────────────────────────
alter table public.compensation_line_items enable row level security;
alter table public.payslip_records enable row level security;
alter table public.project_profit_snapshots enable row level security;

drop policy if exists cli_own_read on public.compensation_line_items;
create policy cli_own_read on public.compensation_line_items
  for select to authenticated
  using (
    payee_user_id = (select auth.uid())
    or payee_crew_id in (
      select id from public.crew_members where auth_user_id = (select auth.uid())
    )
  );

drop policy if exists cli_exec_all on public.compensation_line_items;
create policy cli_exec_all on public.compensation_line_items
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

drop policy if exists ps_own_read on public.payslip_records;
create policy ps_own_read on public.payslip_records
  for select to authenticated
  using (
    payee_user_id = (select auth.uid())
    or payee_crew_id in (
      select id from public.crew_members where auth_user_id = (select auth.uid())
    )
  );

drop policy if exists ps_exec_all on public.payslip_records;
create policy ps_exec_all on public.payslip_records
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

drop policy if exists pps_founder_read on public.project_profit_snapshots;
create policy pps_founder_read on public.project_profit_snapshots
  for select to authenticated
  using (private.has_role_rank(100));

-- ── 5. Self-check ──────────────────────────────────────────────────────────
do $$
begin
  if not has_function_privilege('authenticated', 'public.my_earnings_summary()', 'EXECUTE') then
    raise exception '0014: authenticated cannot execute my_earnings_summary';
  end if;
  if has_function_privilege('anon', 'public.my_earnings_summary()', 'EXECUTE') then
    raise exception '0014: anon must not execute my_earnings_summary';
  end if;
end $$;

commit;
