-- ============================================================================
-- ELTS STUDIO OS — PAYROLL SUMMARY RPCs ACCEPT A RESOLVED CALLER RANK
-- Migration: 0015_payroll_rpc_explicit_rank
-- ============================================================================
-- Regression found during Phase 3 verification.
--
-- 0014 resolved authorisation inside each function via `private.has_role_rank()`,
-- which reads `auth.uid()`. The payroll server actions talk to Postgres through
-- a SERVICE-ROLE client (no JWT), so `auth.uid()` is NULL, rank resolves to 0,
-- and every call returned `{"error":"FORBIDDEN"}`. The hub rendered empty KPIs:
-- "Periode aktif —".
--
-- Same failure mode as the inventory view (0009 -> 0010/0011): a function that
-- checks "who is calling" cannot be called by a connection that has no identity.
--
-- FIX: accept the resolved rank as an explicit argument.
--
--   p_caller_rank integer
--
-- The caller is `requirePageOps()`, which has ALREADY resolved the rank from a
-- real JWT via `get_caller_role()`. Passing it in is not a privilege escalation
-- vector for the endpoints that use these functions, because:
--
--   • EXECUTE is granted to service_role ONLY — never to `authenticated` or
--     `anon`. A browser cannot call these at all; PostgREST will refuse.
--   • The value is clamped: anything outside 0..120 is treated as 0.
--   • The personal telemetry path (`my_earnings_summary`) is untouched. It keeps
--     its zero-argument, `auth.uid()`-scoped signature because end users call it
--     directly and MUST NOT be able to name a rank.

begin;

-- ── 1. Operational rollup (ADMIN and above) ────────────────────────────────
create or replace function public.payroll_operational_summary(p_caller_rank integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank  int := least(greatest(coalesce(p_caller_rank, 0), 0), 120);
  v_month date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
begin
  if v_rank < 80 then
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

revoke all on function public.payroll_operational_summary(integer) from public, anon, authenticated;
grant execute on function public.payroll_operational_summary(integer) to service_role;

-- ── 2. Executive rollup (FOUNDER and above) ────────────────────────────────
create or replace function public.payroll_executive_summary(p_caller_rank integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank  int := least(greatest(coalesce(p_caller_rank, 0), 0), 120);
  v_month date := date_trunc('month', now() at time zone 'Asia/Jakarta')::date;
begin
  -- Below FOUNDER, degrade to the operational view rather than erroring, so an
  -- ADMIN's dashboard renders instead of blanking.
  if v_rank < 100 then
    return public.payroll_operational_summary(v_rank);
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

revoke all on function public.payroll_executive_summary(integer) from public, anon, authenticated;
grant execute on function public.payroll_executive_summary(integer) to service_role;

-- ── 3. Drop the zero-arg variants that resolved identity internally ─────────
-- They were unreachable for application traffic (always FORBIDDEN) and their
-- presence would let a future caller pick the wrong overload.
drop function if exists public.payroll_operational_summary();
drop function if exists public.payroll_executive_summary();

-- ── 4. Self-check ──────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated', 'public.payroll_executive_summary(integer)', 'EXECUTE') then
    raise exception '0015: authenticated must not execute payroll_executive_summary';
  end if;
  if has_function_privilege('anon', 'public.payroll_operational_summary(integer)', 'EXECUTE') then
    raise exception '0015: anon must not execute payroll_operational_summary';
  end if;
  if not has_function_privilege('service_role', 'public.payroll_executive_summary(integer)', 'EXECUTE') then
    raise exception '0015: service_role needs EXECUTE on payroll_executive_summary';
  end if;
end $$;

commit;
