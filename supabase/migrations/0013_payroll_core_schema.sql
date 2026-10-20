-- ============================================================================
-- ELTS STUDIO OS — CORE FINANCIAL SCHEMA (PAYROLL PIVOT)
-- Migration: 0013_payroll_core_schema
-- ============================================================================
-- Replaces the retired float-percentage waterfall with a fixed 5% operational
-- reserve and integer-basis-point partner dividends.
--
-- Approved business rules (founder decision, 2026-10-20):
--   R = sum of VERIFIED invoice payments for the project
--   D = project_expenses (excluding CREW_FEE) + CREW FEES from
--       project_crew_assignments.fee_agreed
--   P = R - D                        (may be negative; recorded as LOSS)
--   V = 5% of P  (only when P > 0)
--   X = P - V                        (distributable; partners split by equity_bp)
--
-- Two sources of truth are pinned here so they cannot drift:
--   • Crew payables come ONLY from `fee_agreed`. `project_expenses` rows with
--     category CREW_FEE are mirrors and are EXCLUDED from D, otherwise every
--     crew fee would be counted twice (live data: 1,750,000 of mirror rows).
--   • R comes ONLY from `v_invoice_financial_position.paid_amount`, which
--     filters `verified_at IS NOT NULL`.

begin;

-- ── 1. Partner equity lives in 0012; nothing to re-add here ────────────────

-- ── 2. Immutable profit snapshot ───────────────────────────────────────────
create table if not exists public.project_profit_snapshots (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete restrict,
  gross_revenue     numeric(14,2) not null default 0 check (gross_revenue >= 0),
  direct_costs      numeric(14,2) not null default 0 check (direct_costs >= 0),
  /** May be negative: a loss is a fact that must be recorded, not clamped. */
  net_profit        numeric(14,2) not null default 0,
  operational_reserve numeric(14,2) not null default 0 check (operational_reserve >= 0),
  distributable_profit numeric(14,2) not null default 0 check (distributable_profit >= 0),
  status            text not null default 'DRAFT'
                      check (status in ('DRAFT','FINALIZED','LOSS','SUPERSEDED')),
  computed_at       timestamptz not null default now(),
  computed_by       uuid references auth.users(id) on delete set null,
  superseded_by     uuid references public.project_profit_snapshots(id),
  /**
   * The invariant the old model lacked. Every rupiah of net profit is either
   * reserved or distributable — never both, never neither.
   */
  constraint profit_balances check (
    operational_reserve + distributable_profit = greatest(net_profit, 0)
  )
);

comment on table public.project_profit_snapshots is
  'Server-computed project economics. Figures are overwritten by trigger; a client-supplied value is never trusted.';

-- Exactly one live snapshot per project.
create unique index if not exists one_live_snapshot_per_project
  on public.project_profit_snapshots(project_id)
  where status in ('DRAFT','FINALIZED','LOSS');

-- ── 3. The enforcement trigger: overwrite, never trust ─────────────────────
create or replace function private.enforce_profit_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_revenue numeric(14,2);
  v_costs   numeric(14,2);
  v_crew    numeric(14,2);
  v_net     numeric(14,2);
  v_reserve numeric(14,2);
begin
  -- R: verified cash only. Unverified transfers must not create profit.
  select coalesce(sum(paid_amount), 0) into v_revenue
    from public.v_invoice_financial_position
   where project_id = new.project_id;

  -- D part 1: operating costs, EXCLUDING the crew-fee mirror rows.
  select coalesce(sum(total_cost), 0) into v_costs
    from public.project_expenses
   where project_id = new.project_id
     and category <> 'CREW_FEE';

  -- D part 2: authoritative crew payables.
  select coalesce(sum(fee_agreed), 0) into v_crew
    from public.project_crew_assignments
   where project_id = new.project_id
     and acceptance_status = 'ACCEPTED';

  v_net := v_revenue - (v_costs + v_crew);

  -- 5% of net profit, only on profit. ROUND(...) on numeric is banker-free
  -- (half-up), matching the invoice view's rounding.
  v_reserve := case when v_net > 0 then round(v_net * 0.05, 2) else 0 end;

  new.gross_revenue        := v_revenue;
  new.direct_costs         := v_costs + v_crew;
  new.net_profit           := v_net;
  new.operational_reserve  := v_reserve;
  /*
   * On a LOSS nothing is distributable. `net - reserve` would be negative
   * (e.g. -2,900,000), which both violates the `>= 0` check and would imply a
   * negative dividend. The loss itself is preserved in `net_profit`; the two
   * distribution columns are floored at zero so the invariant
   * `reserve + distributable = greatest(net, 0)` holds for profit AND loss.
   */
  new.distributable_profit := greatest(v_net - v_reserve, 0);
  new.status               := case when v_net < 0 then 'LOSS'
                                   when tg_op = 'INSERT' then coalesce(new.status, 'DRAFT')
                                   else new.status end;
  return new;
end $$;

revoke all on function private.enforce_profit_snapshot() from public, anon, authenticated;
grant execute on function private.enforce_profit_snapshot() to service_role;

drop trigger if exists trg_enforce_profit_snapshot on public.project_profit_snapshots;
create trigger trg_enforce_profit_snapshot
  before insert on public.project_profit_snapshots
  for each row execute function private.enforce_profit_snapshot();

-- ── 4. Unified compensation ledger ─────────────────────────────────────────
create table if not exists public.compensation_line_items (
  id               uuid primary key default gen_random_uuid(),
  /** Exactly one payee: an internal user OR a freelancer. CHECK below. */
  payee_user_id    uuid references auth.users(id) on delete restrict,
  payee_crew_id    uuid references public.crew_members(id) on delete restrict,
  kind             text not null check (kind in
                     ('CREW_FEE','EDITOR_RATE','SALARY','DIVIDEND','RESERVE')),
  project_id       uuid references public.projects(id) on delete set null,
  /** Provenance: which row produced this payable. */
  source_table     text not null,
  source_id        uuid not null,
  role_label       text,
  gross_amount     numeric(14,2) not null check (gross_amount >= 0),
  deduction_amount numeric(14,2) not null default 0 check (deduction_amount >= 0),
  net_amount       numeric(14,2) generated always as (gross_amount - deduction_amount) stored,
  earned_on        date not null default current_date,
  state            text not null default 'PENDING_VERIFICATION'
                     check (state in ('PENDING_VERIFICATION','APPROVED',
                                      'READY_FOR_DISBURSEMENT','PAID','VOID')),
  payroll_cycle_id uuid,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint one_payee check (
    (payee_user_id is not null)::int + (payee_crew_id is not null)::int = 1
  ),
  /** Idempotency: one payable per source row, per kind. */
  constraint uniq_source_line unique (kind, source_id)
);

comment on table public.compensation_line_items is
  'Every payable across crew, editors, staff and partner dividends. UNIQUE(kind, source_id) makes generation idempotent.';

create index if not exists cli_payee_user on public.compensation_line_items(payee_user_id) where payee_user_id is not null;
create index if not exists cli_payee_crew on public.compensation_line_items(payee_crew_id) where payee_crew_id is not null;
create index if not exists cli_state      on public.compensation_line_items(state);
create index if not exists cli_earned     on public.compensation_line_items(earned_on desc);

-- ── 5. Payroll cycles and payslips ─────────────────────────────────────────
create table if not exists public.payroll_cycles (
  id            uuid primary key default gen_random_uuid(),
  period_key    text not null unique check (period_key ~ '^[0-9]{4}-[0-9]{2}$'),
  status        text not null default 'DRAFT'
                  check (status in ('DRAFT','APPROVED','DISBURSED','CLOSED')),
  opened_at     timestamptz not null default now(),
  approved_at   timestamptz,
  disbursed_at  timestamptz,
  closed_at     timestamptz,
  created_by    uuid references auth.users(id) on delete set null
);

/* deps: line items reference the cycle once generated */
do $$ begin
  alter table public.compensation_line_items
    add constraint cli_cycle_fk foreign key (payroll_cycle_id)
    references public.payroll_cycles(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.payslip_records (
  id               uuid primary key default gen_random_uuid(),
  slip_number      text not null unique
                     check (slip_number ~ '^PAY/[0-9]{4}/[0-9]{2}/[A-Z0-9]{2,6}-[0-9]{4}$'),
  payroll_cycle_id uuid not null references public.payroll_cycles(id) on delete restrict,
  payee_user_id    uuid references auth.users(id) on delete restrict,
  payee_crew_id    uuid references public.crew_members(id) on delete restrict,
  total_gross      numeric(14,2) not null default 0 check (total_gross >= 0),
  total_deduction  numeric(14,2) not null default 0 check (total_deduction >= 0),
  total_net        numeric(14,2) not null default 0 check (total_net >= 0),
  /** HMAC over (id, slip_number, total_net): the QR/verify signature. */
  verification_hash text not null,
  issued_at        timestamptz not null default now(),
  constraint one_payee_slip check (
    (payee_user_id is not null)::int + (payee_crew_id is not null)::int = 1
  ),
  constraint uniq_slip_per_cycle unique (payroll_cycle_id, payee_user_id, payee_crew_id)
);

create index if not exists payslip_payee_user on public.payslip_records(payee_user_id) where payee_user_id is not null;
create index if not exists payslip_payee_crew on public.payslip_records(payee_crew_id) where payee_crew_id is not null;

-- A line item may be attached to exactly one payslip.
do $$ begin
  alter table public.compensation_line_items
    add column payslip_id uuid references public.payslip_records(id) on delete set null;
exception when duplicate_column then null; end $$;

-- ── 6. State machine: forward only ─────────────────────────────────────────
create or replace function private.assert_line_state_forward()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rank_old int;
  v_rank_new int;
begin
  v_rank_old := case old.state when 'PENDING_VERIFICATION' then 0 when 'APPROVED' then 1
                               when 'READY_FOR_DISBURSEMENT' then 2 when 'PAID' then 3 else -1 end;
  v_rank_new := case new.state when 'PENDING_VERIFICATION' then 0 when 'APPROVED' then 1
                               when 'READY_FOR_DISBURSEMENT' then 2 when 'PAID' then 3 else -1 end;

  -- VOID is terminal and reachable from anywhere.
  if new.state = 'VOID' then return new; end if;

  if v_rank_new < v_rank_old then
    raise exception 'compensation state may not move backwards (% -> %)', old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function private.assert_line_state_forward() from public, anon, authenticated;
grant execute on function private.assert_line_state_forward() to service_role;

drop trigger if exists trg_line_state_forward on public.compensation_line_items;
create trigger trg_line_state_forward
  before update on public.compensation_line_items
  for each row execute function private.assert_line_state_forward();

commit;
