-- Migration: 202609240003_finance_splits_schema.sql
-- Waterfall Profit Split & Dual-Approval Finance Engine
begin;

-- 1. Create public.money_splits
create table if not exists public.money_splits (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  gross_revenue numeric not null check (gross_revenue >= 0),
  direct_costs numeric not null default 0 check (direct_costs >= 0),
  net_profit numeric not null check (net_profit >= 0),
  reserve_pct numeric not null default 5.0,
  reserve_amount numeric not null default 0 check (reserve_amount >= 0),
  commission_pct numeric not null default 0.0,
  commission_amount numeric not null default 0 check (commission_amount >= 0),
  closer_name text,
  founder_a_share numeric not null default 0 check (founder_a_share >= 0),
  founder_b_share numeric not null default 0 check (founder_b_share >= 0),
  approved_by_a boolean not null default false,
  approved_by_b boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists money_splits_project_id_idx on public.money_splits(project_id);
create index if not exists money_splits_status_idx on public.money_splits(status);

-- 2. Create public.cash_ledger
create table if not exists public.cash_ledger (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  type text not null check (type in ('INFLOW', 'OUTFLOW', 'FOUNDER_ADVANCE')),
  category text not null check (category in ('PROJECT_SPLIT', 'EQUIPMENT_MAINTENANCE', 'RESERVE_INFLOW', 'DIVIDEND_PAYOUT', 'OPERATIONAL')),
  amount numeric not null check (amount > 0),
  description text not null,
  created_at timestamptz not null default now()
);

create index if not exists cash_ledger_project_id_idx on public.cash_ledger(project_id);
create index if not exists cash_ledger_category_idx on public.cash_ledger(category);
create index if not exists cash_ledger_created_at_idx on public.cash_ledger(created_at desc);

-- 3. Stored Procedure: public.approve_money_split
create or replace function public.approve_money_split(
  p_split_id uuid,
  p_founder text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_split public.money_splits%rowtype;
  v_new_a boolean;
  v_new_b boolean;
  v_new_status text;
  v_now timestamptz := now();
  v_project_name text;
begin
  if p_founder not in ('A', 'B') then
    raise exception 'Invalid founder: %. Must be A or B', p_founder;
  end if;

  select * into v_split
  from public.money_splits
  where id = p_split_id
  for update;

  if not found then
    raise exception 'Money split % not found', p_split_id;
  end if;

  if v_split.status = 'APPROVED' then
    return jsonb_build_object(
      'success', true,
      'message', 'Split already fully approved',
      'split_id', v_split.id,
      'status', v_split.status,
      'approved_by_a', v_split.approved_by_a,
      'approved_by_b', v_split.approved_by_b,
      'reserve_amount', v_split.reserve_amount
    );
  end if;

  v_new_a := case when p_founder = 'A' then true else v_split.approved_by_a end;
  v_new_b := case when p_founder = 'B' then true else v_split.approved_by_b end;

  if v_new_a and v_new_b then
    v_new_status := 'APPROVED';
  else
    v_new_status := 'PENDING_APPROVAL';
  end if;

  update public.money_splits
  set approved_by_a = v_new_a,
      approved_by_b = v_new_b,
      status = v_new_status,
      updated_at = v_now
  where id = p_split_id
  returning * into v_split;

  -- When both approved, automatically insert into public.cash_ledger with category 'RESERVE_INFLOW' and amount = reserve_amount
  if v_new_status = 'APPROVED' and v_split.reserve_amount > 0 then
    select name into v_project_name
    from public.projects
    where id = v_split.project_id;

    insert into public.cash_ledger (
      project_id,
      type,
      category,
      amount,
      description,
      created_at
    ) values (
      v_split.project_id,
      'INFLOW',
      'RESERVE_INFLOW',
      v_split.reserve_amount,
      '5% Studio Reserve from ' || coalesce(v_project_name, 'Project ' || v_split.project_id::text),
      v_now
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'split_id', v_split.id,
    'status', v_split.status,
    'approved_by_a', v_split.approved_by_a,
    'approved_by_b', v_split.approved_by_b,
    'reserve_amount', v_split.reserve_amount
  );
end;
$$;

revoke all on function public.approve_money_split(uuid, text) from public, anon;
grant execute on function public.approve_money_split(uuid, text) to authenticated, service_role;

-- 4. Row Level Security policies
alter table public.money_splits enable row level security;
alter table public.cash_ledger enable row level security;

revoke all on public.money_splits, public.cash_ledger from anon, authenticated;
grant select, insert, update, delete on public.money_splits, public.cash_ledger to authenticated;
grant all on public.money_splits, public.cash_ledger to service_role;

create policy money_splits_admin_all on public.money_splits
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy cash_ledger_admin_all on public.cash_ledger
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

comment on table public.money_splits is 'Waterfall profit split calculations and dual founder approval tracking for projects.';
comment on table public.cash_ledger is 'Studio cash flow ledger tracking reserve inflows, maintenance, payouts, and operational expenses.';
comment on function public.approve_money_split(uuid, text) is 'Dual-approval mechanism for founder splits: approves for founder A or B, and automatically inserts reserve inflow upon full approval.';

notify pgrst, 'reload schema';
commit;
