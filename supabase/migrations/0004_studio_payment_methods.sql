-- ============================================================================
-- ELTS STUDIO OS — STUDIO PAYMENT METHODS
-- Migration: 0004_studio_payment_methods
-- ============================================================================
-- Removes hardcoded bank accounts from `get_client_invoice_dto`.
--
-- WHY
-- ---
-- The RPC embedded two accounts literally:
--     'bank','BCA','account_number','3581216520', ...
--     'bank','Mandiri','account_number','1560023148218', ...
--
-- Consequences:
--   1. Changing a bank account required editing a SECURITY DEFINER function.
--   2. The accounts were emitted for EVERY invoice, including historical ones,
--      so an old invoice silently advertised a current account.
--   3. Any customer holding an old invoice link could read accounts that may
--      no longer be the studio's.
--
-- DESIGN
-- ------
-- Accounts become first-class, versioned rows:
--   * `is_active`  — only active accounts are offered for payment.
--   * `sort_order` — deterministic display order.
--   * `effective_from` / `effective_to` — an account can be retired without
--     losing the record of when it was valid.
--   * `is_primary` — at most one, enforced by a partial unique index.
--
-- The RPC returns an EMPTY ARRAY when nothing is configured. It never invents
-- an account and never falls back to a literal. The client renders an honest
-- "contact the studio" state instead (see client-invoice-view.tsx).
--
-- IDEMPOTENT and ADDITIVE: safe to re-run, no destructive statements.
-- ============================================================================

begin;

-- ── 1. Table ────────────────────────────────────────────────────────────────
create table if not exists public.studio_payment_methods (
  id              uuid primary key default gen_random_uuid(),
  bank_name       text not null check (length(trim(bank_name)) between 1 and 60),
  account_number  text not null check (account_number ~ '^[0-9]{6,32}$'),
  account_holder  text not null check (length(trim(account_holder)) between 1 and 120),
  label           text,
  is_active       boolean not null default true,
  is_primary      boolean not null default false,
  sort_order      integer not null default 0,
  effective_from  date not null default current_date,
  effective_to    date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  -- One row per bank + account number. Prevents an accidental duplicate that
  -- would show the same account twice on an invoice.
  unique (bank_name, account_number)
);

create index if not exists studio_payment_methods_active_idx
  on public.studio_payment_methods (is_active, sort_order)
  where is_active;

-- At most one primary account. A partial unique index is the only way to
-- express "at most one true" in Postgres.
create unique index if not exists studio_payment_methods_one_primary_idx
  on public.studio_payment_methods ((is_primary))
  where is_primary;

comment on table public.studio_payment_methods is
  'Studio bank accounts offered for client payment. Read by get_client_invoice_dto.';

-- ── 2. RLS ──────────────────────────────────────────────────────────────────
alter table public.studio_payment_methods enable row level security;

-- Staff may read; only ADMIN (80) and above may change account details.
-- These accounts appear on customer-facing documents, so editing them is an
-- operations-level action rather than a creative one.
drop policy if exists studio_payment_methods_read on public.studio_payment_methods;
create policy studio_payment_methods_read on public.studio_payment_methods
  for select to authenticated
  using (private.has_role_rank(60));

drop policy if exists studio_payment_methods_write on public.studio_payment_methods;
create policy studio_payment_methods_write on public.studio_payment_methods
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

-- ── 3. Seed current accounts (only if the table is empty) ───────────────────
-- Preserves today's behaviour exactly once, then hands control to the table.
-- Guarded so re-running never duplicates or overwrites an edited catalogue.
insert into public.studio_payment_methods
  (bank_name, account_number, account_holder, is_primary, sort_order)
select * from (values
  ('BCA',     '3581216520',    'Emri Luthfan A.',           true,  10),
  ('Mandiri', '1560023148218', 'Muhammad Rayyan Nufail',    false, 20)
) as v(bank_name, account_number, account_holder, is_primary, sort_order)
where not exists (select 1 from public.studio_payment_methods);

-- ── 4. Refactored RPC ───────────────────────────────────────────────────────
create or replace function public.get_client_invoice_dto(p_invoice_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv      record;
  v_pos      record;
  v_proj     record;
  v_cust     record;
  v_receipts jsonb;
  v_banks    jsonb;
begin
  select * into v_inv
  from public.project_invoices
  where invoice_number = p_invoice_number;

  if not found then
    return jsonb_build_object('error', 'NOT_FOUND', 'message', 'Invoice tidak ditemukan.');
  end if;

  select * into v_pos
  from public.v_invoice_financial_position
  where invoice_id = v_inv.id;

  select id, name, service_pillar, photography_type, shoot_date, customer_id
  into v_proj
  from public.projects
  where id = v_inv.project_id;

  select name, email, phone into v_cust
  from public.customers
  where id = v_proj.customer_id;

  -- Payment history: date, method, amount, verified. NEVER a cost category.
  select coalesce(jsonb_agg(jsonb_build_object(
           'receipt_number', r.receipt_number,
           'amount', r.amount,
           'payment_method', r.payment_method,
           'bank_name', r.bank_name,
           'received_at', r.received_at,
           'applied_to', r.applied_to,
           'verified', r.verified_at is not null
         ) order by r.received_at), '[]'::jsonb)
  into v_receipts
  from public.invoice_payment_receipts r
  where r.invoice_id = v_inv.id and r.verified_at is not null;

  /*
   * Active accounts only, ordered for display. Empty when none are configured:
   * the client renders "contact the studio" rather than a fabricated account.
   *
   * `p_invoice_number` is not used to filter accounts — an invoice does not own
   * a bank account. Only `is_active`, the effective window, and sort order apply.
   */
  select coalesce(jsonb_agg(jsonb_build_object(
           'bank',           pm.bank_name,
           'account_number', pm.account_number,
           'account_holder', pm.account_holder,
           'label',          pm.label
         ) order by pm.is_primary desc, pm.sort_order, pm.bank_name), '[]'::jsonb)
  into v_banks
  from public.studio_payment_methods pm
  where pm.is_active
    and pm.effective_from <= current_date
    and (pm.effective_to is null or pm.effective_to >= current_date);

  return jsonb_build_object(
    'invoice_number', v_inv.invoice_number,
    'issue_date', v_inv.issue_date,
    'due_date', v_inv.due_date,
    'line_items', v_inv.line_items,
    'client_notes', v_inv.client_notes,
    'contract_value', v_pos.contract_value,
    'paid_amount', v_pos.paid_amount,
    'balance_due', v_pos.balance_due,
    'overpayment_amount', v_pos.overpayment_amount,
    'payment_status', v_pos.derived_status,
    'dp_floor_satisfied', v_pos.dp_floor_satisfied,
    'payments', v_receipts,
    'project', jsonb_build_object(
      'id', v_proj.id, 'name', v_proj.name,
      'service_pillar', v_proj.service_pillar, 'shoot_date', v_proj.shoot_date
    ),
    'customer', jsonb_build_object(
      'name', v_cust.name, 'phone', v_cust.phone, 'email', v_cust.email
    ),
    -- Sourced from the configuration table. No literals in this function.
    'studio_bank_details', v_banks
  );
end;
$$;

revoke all on function public.get_client_invoice_dto(text) from public;
grant execute on function public.get_client_invoice_dto(text)
  to anon, authenticated, service_role;

comment on function public.get_client_invoice_dto(text) is
  'Client-facing invoice DTO. Bank details come from public.studio_payment_methods; empty array when unconfigured.';

commit;
