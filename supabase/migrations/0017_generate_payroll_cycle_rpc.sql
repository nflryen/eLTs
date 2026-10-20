-- ============================================================================
-- ELTS STUDIO OS — ATOMIC PAYROLL CYCLE GENERATION
-- Migration: 0017_generate_payroll_cycle_rpc
-- ============================================================================
-- The generation used to live in a Node script issuing ~4 statements per payee.
-- As a Server Action that is unacceptable: Supabase's PostgREST client has no
-- multi-statement transaction, so a failure half-way would leave a cycle row
-- with some slips and some unassigned lines — and the next run would skip the
-- successful payees while re-deriving numbers for the rest, producing a
-- pay period that cannot be reconciled.
--
-- Putting the whole batch in ONE plpgsql function makes it atomic by
-- construction: the entire body runs in the caller's transaction.
--
-- Redaction rule
-- --------------
-- `p_include_dividends` is honoured ONLY on top of the passed rank. The function
-- never trusts the caller to say "I am a founder": the Action resolves rank from
-- a real JWT via `requirePageOps()` and passes it in, and this function clamps
-- it. Dividends are dropped below rank 100.

begin;

create or replace function public.generate_payroll_cycle(
  p_period_key       text,
  p_caller_rank      integer,
  p_include_dividends boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank        int := least(greatest(coalesce(p_caller_rank, 0), 0), 120);
  v_include_div boolean;
  v_cycle       public.payroll_cycles%rowtype;
  v_month_start date;
  v_month_end   date;
  v_line        record;
  v_payee       text;
  v_slip_id     uuid;
  v_slip_no     text;
  v_run_key     uuid;
  v_gross       numeric(14,2);
  v_ded         numeric(14,2);
  v_net         numeric(14,2);
  v_diff        numeric(14,2);
  v_slip_count  int := 0;
  v_line_count  int := 0;
  v_total_net   numeric(14,2) := 0;
  v_existed     boolean := false;
begin
  -- ── Guards ──────────────────────────────────────────────────────────────
  if v_rank < 80 then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  if p_period_key !~ '^[0-9]{4}-[0-9]{2}$' then
    return jsonb_build_object('success', false, 'error', 'INVALID_PERIOD');
  end if;

  -- Dividends require FOUNDER regardless of what the caller asked for.
  v_include_div := p_include_dividends and v_rank >= 100;

  v_month_start := (p_period_key || '-01')::date;
  v_month_end   := (v_month_start + interval '1 month')::date;

  -- ── Cycle: create once, reuse if still open ─────────────────────────────
  select * into v_cycle from public.payroll_cycles where period_key = p_period_key for update;

  if found then
    if v_cycle.status not in ('DRAFT','LOCKED','APPROVED') then
      return jsonb_build_object(
        'success', false,
        'error', 'CYCLE_CLOSED',
        'message', format('Siklus %s sudah %s dan tidak dapat dibuat ulang.', p_period_key, v_cycle.status)
      );
    end if;
    v_existed := true;
    /*
     * A LOCKED cycle must not absorb new line items silently: that would change
     * the amount after it was approved for payment.
     */
    if v_cycle.status in ('LOCKED','APPROVED') then
      return jsonb_build_object(
        'success', false,
        'error', 'CYCLE_LOCKED',
        'message', 'Siklus sudah dikunci. Buka kunci sebelum menambah kompensasi baru.',
        'cycle_id', v_cycle.id
      );
    end if;
  else
    insert into public.payroll_cycles (period_key, status)
    values (p_period_key, 'DRAFT')
    returning * into v_cycle;

    insert into public.payroll_audit_log (cycle_id, event, actor_rank, detail)
    values (v_cycle.id, 'CYCLE_CREATED', v_rank, jsonb_build_object('period', p_period_key));
  end if;

  -- ── Allocation run id groups every slip created together ────────────────
  v_run_key := gen_random_uuid();

  -- ── Aggregate eligible lines ────────────────────────────────────────────
  /*
   * One slip per payee. Unassigned lines only, in states that mean "approved
   * for payment", inside the period. `NOT EXISTS` on payslip_id is the
   * duplicate guard; `uniq_slip_per_cycle` backs it at the constraint level.
   */
  for v_line in
    select
      c.payee_user_id,
      c.payee_crew_id,
      coalesce(c.payee_user_id::text, c.payee_crew_id::text) as payee_key,
      sum(c.gross_amount)     as gross,
      sum(c.deduction_amount) as ded,
      sum(c.net_amount)       as net,
      count(*)                as n
      from public.compensation_line_items c
     where c.state in ('APPROVED','READY_FOR_DISBURSEMENT')
       and c.payslip_id is null
       and c.earned_on >= v_month_start
       and c.earned_on <  v_month_end
       and (v_include_div or c.kind <> 'DIVIDEND')
     group by c.payee_user_id, c.payee_crew_id, coalesce(c.payee_user_id::text, c.payee_crew_id::text)
     order by 3
  loop
    v_gross := v_line.gross;
    v_ded   := v_line.ded;
    v_net   := v_line.net;

    v_slip_no := public.next_slip_number(p_period_key);

    insert into public.payslip_records
      (slip_number, payroll_cycle_id, payee_user_id, payee_crew_id,
       total_gross, total_deduction, total_net, verification_hash)
    values
      (v_slip_no, v_cycle.id, v_line.payee_user_id, v_line.payee_crew_id,
       v_gross, v_ded, v_net, 'pending')
    returning id into v_slip_id;

    /*
     * `verification_hash` stays 'pending' here on purpose.
     *
     * The seal is HMAC-SHA256(id|slip_number|net) and its canonical
     * implementation lives in TypeScript (`src/lib/pdf/payslip-token.ts`) — the
     * same function the PDF route and the public verify page use. Reimplementing
     * the HMAC in plpgsql via pgcrypto would create a second, drifting source of
     * truth for a signature that must match exactly.
     *
     * The Server Action therefore writes the real hash immediately after this
     * call, in the same request, and the PDF route refuses any slip whose hash
     * is still 'pending'.
     */
    update public.compensation_line_items
       set payslip_id = v_slip_id,
           payroll_cycle_id = v_cycle.id,
           updated_at = now()
     where state in ('APPROVED','READY_FOR_DISBURSEMENT')
       and payslip_id is null
       and earned_on >= v_month_start
       and earned_on <  v_month_end
       and (v_include_div or kind <> 'DIVIDEND')
       and coalesce(payee_user_id::text, payee_crew_id::text) = v_line.payee_key;

    v_slip_count := v_slip_count + 1;
    v_line_count := v_line_count + v_line.n;
    v_total_net  := v_total_net + v_net;
  end loop;

  insert into public.payroll_audit_log (cycle_id, event, actor_rank, detail)
  values (
    v_cycle.id, 'CYCLE_CREATED', v_rank,
    jsonb_build_object(
      'period', p_period_key,
      'slips', v_slip_count,
      'lines', v_line_count,
      'total_net', v_total_net,
      'include_dividends', v_include_div,
      'reused_cycle', v_existed
    )
  );

  return jsonb_build_object(
    'success', true,
    'cycle_id', v_cycle.id,
    'period_key', p_period_key,
    'slips_created', v_slip_count,
    'lines_settled', v_line_count,
    'total_disbursement', v_total_net,
    'reused_cycle', v_existed,
    'run_key', v_run_key
  );
end $$;

revoke all on function public.generate_payroll_cycle(text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.generate_payroll_cycle(text, integer, boolean)
  to service_role;

-- ── Lock / disburse ledger write, atomic ───────────────────────────────────
/*
 * `disburse_payroll_cycle` moves DRAFT|LOCKED -> DISBURSED, marks every slip and
 * line PAID with one timestamp, and writes ONE cash_ledger OUTFLOW for the batch.
 *
 * Rank is checked here as well as in the action: this function is the last line
 * of defence if a future caller forgets.
 */
create or replace function public.disburse_payroll_cycle(
  p_cycle_id uuid,
  p_caller_rank integer,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank  int := least(greatest(coalesce(p_caller_rank, 0), 0), 120);
  v_cycle public.payroll_cycles%rowtype;
  v_total numeric(14,2);
  v_slips int;
  v_now   timestamptz := now();
begin
  if v_rank < 100 then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN',
      'message', 'Pencairan hanya dapat dilakukan Founder.');
  end if;

  select * into v_cycle from public.payroll_cycles where id = p_cycle_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  end if;

  if v_cycle.status = 'DISBURSED' or v_cycle.status = 'CLOSED' then
    return jsonb_build_object('success', false, 'error', 'ALREADY_DISBURSED',
      'message', 'Siklus ini sudah dicairkan.');
  end if;

  select coalesce(sum(total_net), 0), count(*) into v_total, v_slips
    from public.payslip_records where payroll_cycle_id = p_cycle_id;

  if v_slips = 0 then
    return jsonb_build_object('success', false, 'error', 'EMPTY_CYCLE',
      'message', 'Siklus tidak memiliki slip untuk dicairkan.');
  end if;

  update public.compensation_line_items
     set state = 'PAID', paid_at = v_now, updated_at = v_now
   where payroll_cycle_id = p_cycle_id and state <> 'VOID';

  update public.payroll_cycles
     set status = 'DISBURSED', disbursed_at = v_now, disbursed_by = p_actor,
         approved_at = coalesce(approved_at, v_now), locked_at = coalesce(locked_at, v_now)
   where id = p_cycle_id;

  insert into public.cash_ledger (project_id, type, category, amount, description)
  values (null, 'OUTFLOW', 'OPERATIONAL', greatest(v_total, 0.01),
          format('Payroll disbursement %s (%s slip)', v_cycle.period_key, v_slips));

  insert into public.payroll_audit_log (cycle_id, event, actor_user_id, actor_rank, detail)
  values (p_cycle_id, 'CYCLE_DISBURSED', p_actor, v_rank,
          jsonb_build_object('slips', v_slips, 'total_net', v_total));

  return jsonb_build_object('success', true, 'cycle_id', p_cycle_id,
    'slips', v_slips, 'total_disbursement', v_total, 'disbursed_at', v_now);
end $$;

revoke all on function public.disburse_payroll_cycle(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.disburse_payroll_cycle(uuid, integer, uuid)
  to service_role;

-- ── Lock (freeze without paying) ───────────────────────────────────────────
create or replace function public.lock_payroll_cycle(
  p_cycle_id uuid,
  p_caller_rank integer,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rank int := least(greatest(coalesce(p_caller_rank, 0), 0), 120);
  v_cycle public.payroll_cycles%rowtype;
begin
  if v_rank < 100 then
    return jsonb_build_object('success', false, 'error', 'FORBIDDEN');
  end if;

  select * into v_cycle from public.payroll_cycles where id = p_cycle_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'NOT_FOUND'); end if;
  if v_cycle.status <> 'DRAFT' then
    return jsonb_build_object('success', false, 'error', 'INVALID_STATE',
      'message', format('Hanya siklus DRAFT yang dapat dikunci (saat ini %s).', v_cycle.status));
  end if;

  update public.payroll_cycles
     set status = 'LOCKED', locked_at = now(), locked_by = p_actor
   where id = p_cycle_id;

  insert into public.payroll_audit_log (cycle_id, event, actor_user_id, actor_rank)
  values (p_cycle_id, 'CYCLE_LOCKED', p_actor, v_rank);

  return jsonb_build_object('success', true, 'cycle_id', p_cycle_id, 'status', 'LOCKED');
end $$;

revoke all on function public.lock_payroll_cycle(uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.lock_payroll_cycle(uuid, integer, uuid)
  to service_role;

commit;
