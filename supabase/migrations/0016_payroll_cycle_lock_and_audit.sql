-- ============================================================================
-- ELTS STUDIO OS — PAYROLL CYCLE LOCK STATE + AUDIT LEDGER LINK
-- Migration: 0016_payroll_cycle_lock_and_audit
-- ============================================================================
-- Adds the DRAFT -> LOCKED -> DISBURSED lifecycle the UI drives, and an
-- append-only audit trail for disbursement events.
--
-- WHY A NEW TABLE AND NOT `cash_ledger`
-- -------------------------------------
-- `cash_ledger` is a MUTABLE single-entry log with no `created_by`, no
-- counterparty and no immutability trigger (audit finding L3). A disbursement
-- is a governance event: who authorised which rupiah to whom, and when. It needs
-- its own append-only record that cannot be edited after the fact.
--
-- The cash_ledger OUTFLOW row is still written, because treasury needs to see
-- the money leave the account. The audit row is the evidence; the ledger row is
-- the balance movement.

begin;

-- ── 1. Widen the cycle status enum ─────────────────────────────────────────
/*
 * `payroll_cycles.status` was CHECK-constrained to
 * ('DRAFT','APPROVED','DISBURSED','CLOSED'). The workflow now distinguishes
 * "reviewed and frozen" from "money has left the account":
 *
 *   DRAFT      generated, line items still editable
 *   LOCKED     approved for payment; line items frozen, nothing paid yet
 *   DISBURSED  paid; `paid_at` stamped on every slip and line item
 *   CLOSED     accounting period archived
 *
 * APPROVED is kept for rows written by the earlier script so existing data
 * stays valid; it is treated as equivalent to LOCKED when reading.
 */
alter table public.payroll_cycles drop constraint if exists payroll_cycles_status_check;
alter table public.payroll_cycles
  add constraint payroll_cycles_status_check
  check (status in ('DRAFT','LOCKED','APPROVED','DISBURSED','CLOSED'));

alter table public.payroll_cycles
  add column if not exists locked_at    timestamptz,
  add column if not exists locked_by    uuid references auth.users(id) on delete set null,
  add column if not exists disbursed_by uuid references auth.users(id) on delete set null;

-- ── 2. Append-only disbursement audit ──────────────────────────────────────
create table if not exists public.payroll_audit_log (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid references public.payroll_cycles(id) on delete restrict,
  event         text not null check (event in
                  ('CYCLE_CREATED','CYCLE_LOCKED','CYCLE_DISBURSED','CYCLE_CLOSED',
                   'LINE_APPROVED','LINE_READY','LINE_VOID')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_rank    integer,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists payroll_audit_cycle on public.payroll_audit_log(cycle_id, created_at desc);

-- Append-only: no UPDATE, no DELETE, ever. Enforced, not documented.
create or replace function private.reject_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'payroll_audit_log is append-only (% blocked)', tg_op
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists trg_payroll_audit_immutable on public.payroll_audit_log;
create trigger trg_payroll_audit_immutable
  before update or delete on public.payroll_audit_log
  for each row execute function private.reject_audit_mutation();

-- ── 3. Slip numbering: PAY/YYYY/MM/ELT-NNNN ────────────────────────────────
/*
 * The script emitted `PAY/2026/10/CRWEL-0001` (per-recipient crew code). The
 * approved format is a single studio-wide sequence: `PAY/2026/10/ELT-0042`.
 * A per-recipient suffix made the number predictable from the person's crew
 * code, which leaks who a slip belongs to from the number alone.
 *
 * Existing rows keep their numbers (they are already signed into QR codes and
 * printed). Only new slips use ELT.
 */
alter table public.payslip_records drop constraint if exists payslip_records_slip_number_check;
alter table public.payslip_records
  add constraint payslip_records_slip_number_check
  check (slip_number ~ '^PAY/[0-9]{4}/[0-9]{2}/[A-Z]{2,6}-[0-9]{4}$');

/*
 * Gap-free per-period slip sequence, reusing the existing atomic
 * `next_document_number` allocator so concurrent generation cannot collide.
 */
create or replace function public.next_slip_number(p_period_key text)
returns text language sql security definer set search_path = '' as $$
  select 'PAY/' || split_part(p_period_key, '-', 1) || '/'
         || split_part(p_period_key, '-', 2) || '/ELT-'
         || lpad(public.next_document_number('PAY', p_period_key)::text, 4, '0');
$$;

revoke all on function public.next_slip_number(text) from public, anon, authenticated;
grant execute on function public.next_slip_number(text) to service_role;

commit;
