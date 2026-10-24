-- ── 0033 Project Workspace Refinements & Cascades ───────────────────────────

-- 1. Add referral columns to public.projects
alter table public.projects add column if not exists referral_code text;
alter table public.projects add column if not exists referral_discount_amount numeric default 0 check (referral_discount_amount >= 0);

-- 2. Clean cascade on invoice receipts and profit snapshots when project/invoice is deleted
alter table public.project_profit_snapshots drop constraint if exists project_profit_snapshots_project_id_fkey;
alter table public.project_profit_snapshots add constraint project_profit_snapshots_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete cascade;

alter table public.invoice_payment_receipts drop constraint if exists invoice_payment_receipts_invoice_id_fkey;
alter table public.invoice_payment_receipts add constraint invoice_payment_receipts_invoice_id_fkey
  foreign key (invoice_id) references public.project_invoices(id) on delete cascade;

-- 3. Staff/Finance permission (rank >= 80) for payment receipt logging
drop policy if exists invoice_payment_receipts_rbac_write on public.invoice_payment_receipts;
create policy invoice_payment_receipts_rbac_write on public.invoice_payment_receipts
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

drop policy if exists invoice_payment_receipts_rbac_read on public.invoice_payment_receipts;
create policy invoice_payment_receipts_rbac_read on public.invoice_payment_receipts
  for select to authenticated
  using (private.has_role_rank(80));
