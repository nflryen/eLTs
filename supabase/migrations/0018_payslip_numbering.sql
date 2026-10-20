-- ============================================================================
-- ELTS STUDIO OS — PAYSLIP NUMBERING (PAY document type)
-- Migration: 0018_payslip_numbering
-- ============================================================================
-- Fixes 0016/0017.
--
-- `public.next_document_number(doc_type, period)` returns a FORMATTED string
-- such as `INV/2026/10/0001` — not an integer. My first `next_slip_number`
-- wrapped it as `lpad(...::text, 4, '0')`, which would have produced
-- `PAY/2026/10/ELT-PAY/2026/10/0001`. It also failed outright because `PAY` was
-- not in the allocator's whitelist ('INV','PO','OUT','RCP').
--
-- Two changes, both minimal:
--   1. `next_document_number` accepts 'PAY' so payslips share the same atomic,
--      gap-free, per-period sequence as invoices and receipts.
--   2. `next_slip_number` builds the approved `PAY/YYYY/MM/ELT-NNNN` shape by
--      composing the allocator rather than reimplementing the counter.

begin;

create or replace function public.next_document_number(
  p_doc_type   text,
  p_period_key text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_next integer;
begin
  if p_doc_type not in ('INV','PO','OUT','RCP','PAY') then
    raise exception 'Unknown document type: %', p_doc_type;
  end if;
  if p_period_key !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'Invalid period key (expected YYYY-MM): %', p_period_key;
  end if;

  insert into public.document_sequences (doc_type, period_key, last_value)
  values (p_doc_type, p_period_key, 1)
  on conflict (doc_type, period_key)
    do update set last_value = public.document_sequences.last_value + 1,
                  updated_at = now()
  returning last_value into v_next;

  return p_doc_type || '/' || replace(p_period_key, '-', '/') || '/' ||
         lpad(v_next::text, 4, '0');
end;
$$;

revoke all on function public.next_document_number(text, text) from public, anon;
grant execute on function public.next_document_number(text, text) to authenticated, service_role;

-- ── Slip number: PAY/YYYY/MM/ELT-NNNN ──────────────────────────────────────
/*
 * Delegates the counter to `next_document_number('PAY', period)` and reshapes
 * only the prefix/suffix. Taking `split_part` of its output keeps this in step
 * if the allocator's internal format ever changes.
 */
create or replace function public.next_slip_number(p_period_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw     text;
  v_serial  text;
begin
  v_raw    := public.next_document_number('PAY', p_period_key);
  -- v_raw = 'PAY/2026/10/0007' -> serial '0007'
  v_serial := split_part(v_raw, '/', 4);
  return 'PAY/' || split_part(p_period_key, '-', 1) || '/'
         || split_part(p_period_key, '-', 2) || '/ELT-' || v_serial;
end $$;

revoke all on function public.next_slip_number(text) from public, anon, authenticated;
grant execute on function public.next_slip_number(text) to service_role;

-- ── Self-check ─────────────────────────────────────────────────────────────
do $$
declare v_sample text;
begin
  v_sample := public.next_slip_number('2099-12');
  if v_sample !~ '^PAY/2099/12/ELT-[0-9]{4}$' then
    raise exception '0018: bad slip format: %', v_sample;
  end if;
  delete from public.document_sequences where doc_type='PAY' and period_key='2099-12';
end $$;

commit;
