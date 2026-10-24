begin;

/*
 * 0031 — Referral code & sales commission system.
 *
 * SYSTEM DESIGN
 * -------------
 * Allows marketing partners and internal sales reps to issue custom referral
 * codes (e.g. `SUMMER2026`, `RIANSALES10`).
 *
 * Discount types:
 *   - 'fixed'       : Fixed IDR discount (e.g. Rp 200.000 off total)
 *   - 'percentage'  : Percentage discount (e.g. 10% off total, max 100%)
 *
 * Usage limits & validity:
 *   - `max_uses`    : Optional ceiling on total redemptions (null = unlimited)
 *   - `used_count`  : Atomic counter incremented upon successful booking/conversion
 *   - `expiry_date` : Optional expiry calendar date
 *   - `status`      : 'ACTIVE' | 'DISABLED' | 'EXPIRED'
 *
 * Tracking:
 *   - `inquiries.referral_code_id` / `inquiries.referral_code` records the code on lead capture
 *   - `project_invoices.referral_code_id` / `referral_code` records the discount on commercial invoice
 */

create table if not exists public.referral_codes (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  sales_name     text not null check (length(trim(sales_name)) >= 2),
  discount_type  text not null check (discount_type in ('fixed', 'percentage')),
  discount_value numeric not null check (discount_value > 0),
  max_uses       integer check (max_uses is null or max_uses > 0),
  used_count     integer not null default 0 check (used_count >= 0),
  expiry_date    date,
  status         text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED', 'EXPIRED')),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint referral_percentage_max_check check (
    discount_type != 'percentage' or discount_value <= 100
  )
);

-- Index for case-insensitive lookup & status checks
create unique index if not exists referral_codes_upper_idx
  on public.referral_codes (upper(code));

create index if not exists referral_codes_active_lookup_idx
  on public.referral_codes (status, expiry_date)
  where status = 'ACTIVE';

-- ── Extend inquiries table to track referral code ───────────────────────────
alter table public.inquiries
  add column if not exists referral_code_id uuid references public.referral_codes(id) on delete set null,
  add column if not exists referral_code    text,
  add column if not exists referral_discount_amount numeric default 0;

-- ── Extend project_invoices table to record referral discount ───────────────
alter table public.project_invoices
  add column if not exists referral_code_id uuid references public.referral_codes(id) on delete set null,
  add column if not exists referral_code    text,
  add column if not exists referral_discount_amount numeric default 0;

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.referral_codes enable row level security;

-- Admin/Staff (rank >= 80): full management
drop policy if exists referral_codes_admin_all on public.referral_codes;
create policy referral_codes_admin_all on public.referral_codes
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

-- Public/anon: can read active codes for checkout validation
drop policy if exists referral_codes_public_read on public.referral_codes;
create policy referral_codes_public_read on public.referral_codes
  for select to anon
  using (
    status = 'ACTIVE'
    and (expiry_date is null or expiry_date >= current_date)
    and (max_uses is null or used_count < max_uses)
  );

create or replace function public.increment_referral_usage(p_referral_id uuid)
returns void
language sql
security definer
as $$
  update public.referral_codes
  set used_count = used_count + 1,
      updated_at = now()
  where id = p_referral_id;
$$;

grant execute on function public.increment_referral_usage(uuid) to anon, authenticated;
grant select, insert, update, delete on public.referral_codes to authenticated;
grant select on public.referral_codes to anon;

commit;
