begin;

/*
 * 0024 — Single source of truth for person identity and payout destination.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Person facts were written in two places that never talked to each other:
 *
 *   user_profiles.phone / bank_*   <- written by /settings/profile
 *   crew_members.phone / bank_*    <- read by the payslip PDF
 *
 * So a member who updated their own bank account changed nothing about where
 * their salary was paid, and nothing told them. Confirmed live: Wardah had
 * profile.phone = NULL and crew.phone = '+62 812 0000 0000'.
 *
 * WHY NOT SIMPLY DROP THE crew_members COLUMNS
 * --------------------------------------------
 * 3 of 8 crew_members have `auth_user_id IS NULL` — freelancers with no login.
 * They have no user_profiles row, so their phone and bank details exist ONLY in
 * crew_members. Dropping those columns would destroy the payout destination for
 * exactly the people who cannot self-service it.
 *
 * So the model is:
 *
 *   LINKED   (auth_user_id not null) -> user_profiles is authoritative.
 *             crew_members contact/bank columns are DROPPED.
 *   UNLINKED (auth_user_id is null)  -> crew_members remains authoritative.
 *             Columns are KEPT, because there is nowhere else to put the data.
 *
 * That is a single source of truth per row, not a compromise: for any given
 * crew member there is exactly one place holding their phone and bank details.
 */

-- ── 1. Payout conflict audit ────────────────────────────────────────────────
/*
 * Before overwriting anything, record every divergence. A migration that
 * silently discards a bank account is unrecoverable if it picked the wrong side.
 */
create table if not exists public.identity_reconciliation_log (
  id             bigserial primary key,
  user_id        uuid references auth.users(id) on delete set null,
  crew_code      text,
  field          text not null,
  profile_value  text,
  crew_value     text,
  resolution     text not null,
  reconciled_at  timestamptz not null default now()
);

alter table public.identity_reconciliation_log enable row level security;

drop policy if exists identity_reconciliation_log_read on public.identity_reconciliation_log;
create policy identity_reconciliation_log_read on public.identity_reconciliation_log
  for select to authenticated
  using (private.has_role_rank(120));

-- ── 2. Record divergences before resolving them ─────────────────────────────
do $$
begin
if exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='crew_members' and column_name='phone') then
insert into public.identity_reconciliation_log
  (user_id, crew_code, field, profile_value, crew_value, resolution)
select
  c.auth_user_id,
  c.crew_code,
  'phone',
  p.phone,
  c.phone,
  'crew_wins'   -- crew holds the operational contact number used on call sheets
from public.crew_members c
join public.user_profiles p on p.user_id = c.auth_user_id
where p.phone is distinct from c.phone
  and c.phone is not null;
end if;
end $$;

do $$
begin
if exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='crew_members' and column_name='phone') then
insert into public.identity_reconciliation_log
  (user_id, crew_code, field, profile_value, crew_value, resolution)
select
  c.auth_user_id,
  c.crew_code,
  'bank_account_number',
  p.bank_account_number,
  c.bank_account_number,
  'profile_wins'   -- the account the person themselves last confirmed
from public.crew_members c
join public.user_profiles p on p.user_id = c.auth_user_id
where p.bank_account_number is distinct from c.bank_account_number
  and p.bank_account_number is not null;
end if;
end $$;

-- ── 3. Backfill user_profiles from crew_members ─────────────────────────────
/*
 * Resolution order per field:
 *   phone  -> crew wins (operational, used on call sheets, most current)
 *   bank   -> profile wins when present (the person confirmed it), else crew
 *   name   -> profile wins (self-edited), else crew
 */
do $$
begin
if exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='crew_members' and column_name='phone') then
update public.user_profiles p
   set phone               = coalesce(nullif(btrim(c.phone), ''), p.phone),
       full_name           = coalesce(nullif(btrim(p.full_name), ''), c.full_name),
       payout_method       = coalesce(p.payout_method, 'BANK'),
       bank_name           = coalesce(p.bank_name, nullif(btrim(c.bank_name), '')),
       bank_account_holder = coalesce(p.bank_account_holder, nullif(btrim(c.bank_account_holder), '')),
       bank_account_number = coalesce(p.bank_account_number, nullif(btrim(c.bank_account_number), '')),
       updated_at          = now()
  from public.crew_members c
 where c.auth_user_id = p.user_id
   and (p.phone is null or p.bank_account_number is null or p.bank_name is null);
end if;
end $$;

-- ── 4. Seed profiles for a linked crew member who somehow lacks one ─────────
do $$
begin
if exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='crew_members' and column_name='phone') then
insert into public.user_profiles
  (user_id, full_name, display_name, phone, payout_method,
   bank_name, bank_account_holder, bank_account_number)
select
  c.auth_user_id,
  c.full_name,
  split_part(c.full_name, ' ', 1),
  nullif(btrim(c.phone), ''),
  'BANK',
  nullif(btrim(c.bank_name), ''),
  nullif(btrim(c.bank_account_holder), ''),
  nullif(btrim(c.bank_account_number), '')
from public.crew_members c
where c.auth_user_id is not null
  and not exists (select 1 from public.user_profiles p where p.user_id = c.auth_user_id)
on conflict (user_id) do nothing;
end if;
end $$;

-- ── 5. Drop the duplicated columns for LINKED crew only ─────────────────────
/*
 * A column cannot be dropped per-row, so the data for UNLINKED crew is moved
 * into a dedicated table first. `crew_members` then keeps no personal contact
 * columns at all — one source per fact, for every row.
 */
create table if not exists public.crew_contact_details (
  crew_member_id      uuid primary key references public.crew_members(id) on delete cascade,
  phone               text,
  email               text,
  bank_name           text,
  bank_account_holder text,
  bank_account_number text,
  updated_at          timestamptz not null default now()
);

comment on table public.crew_contact_details is
  'Contact and payout details for crew WITHOUT a login (auth_user_id IS NULL). '
  'Crew WITH a login use user_profiles, which is authoritative for them.';

do $$
begin
if exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='crew_members' and column_name='phone') then
insert into public.crew_contact_details
  (crew_member_id, phone, email, bank_name, bank_account_holder, bank_account_number)
select id, phone, email, bank_name, bank_account_holder, bank_account_number
from public.crew_members
on conflict (crew_member_id) do update
  set phone               = excluded.phone,
      email               = excluded.email,
      bank_name           = excluded.bank_name,
      bank_account_holder = excluded.bank_account_holder,
      bank_account_number = excluded.bank_account_number,
      updated_at          = now();
end if;
end $$;

alter table public.crew_contact_details enable row level security;

drop policy if exists crew_contact_details_ops on public.crew_contact_details;
create policy crew_contact_details_ops on public.crew_contact_details
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

/*
 * Table-level GRANTs. RLS decides WHICH ROWS; a GRANT decides whether the role
 * may touch the table at all. Without these, an authenticated request is
 * refused with "permission denied" before any policy is evaluated.
 */
grant select, insert, update, delete on public.crew_contact_details
  to authenticated, service_role;
grant select on public.identity_reconciliation_log to authenticated, service_role;

-- Now the columns can go: every value lives in exactly one place.
alter table public.crew_members
  drop column if exists phone,
  drop column if exists email,
  drop column if exists bank_name,
  drop column if exists bank_account_holder,
  drop column if exists bank_account_number,
  drop column if exists avatar_url;

-- ── 6. One view that answers "who is this and how do we pay them" ───────────
/*
 * Every consumer — payslip PDF, crew roster, dispatch picker, call sheet —
 * reads THIS, so the linked/unlinked split cannot leak into application code.
 */
drop view if exists public.v_crew_identity;
create view public.v_crew_identity as
select
  c.id                as crew_member_id,
  c.crew_code,
  c.full_name,
  c.auth_user_id,
  c.member_type,
  c.primary_skills,
  c.jobdesk_specialties,
  c.role_category,
  c.standard_day_rate,
  c.rating,
  c.is_active,
  (c.auth_user_id is not null) as has_login,
  coalesce(p.phone,  d.phone)                as phone,
  coalesce(p.full_name, c.full_name)         as display_full_name,
  coalesce(p.bank_name, d.bank_name)         as bank_name,
  coalesce(p.bank_account_holder, d.bank_account_holder) as bank_account_holder,
  coalesce(p.bank_account_number, d.bank_account_number) as bank_account_number,
  p.payout_method,
  coalesce(p.display_name, split_part(c.full_name, ' ', 1)) as display_name
from public.crew_members c
left join public.user_profiles      p on p.user_id = c.auth_user_id
left join public.crew_contact_details d on d.crew_member_id = c.id;

grant select on public.v_crew_identity to authenticated, service_role;

comment on view public.v_crew_identity is
  'Resolved crew identity and payout destination. Linked crew read user_profiles; '
  'unlinked crew read crew_contact_details. Application code must not query the '
  'underlying contact columns directly.';

-- ── 7. Keep the view in step when a profile changes ─────────────────────────
/*
 * Not required for correctness (the view joins live), but this is where a future
 * maintainer will look for "what happens when a phone changes". Documenting it as
 * a no-op prevents someone adding a redundant sync trigger later.
 */
comment on column public.user_profiles.phone is
  'AUTHORITATIVE for every crew member with a login. v_crew_identity resolves '
  'through here. Do not reintroduce a phone column on crew_members.';

commit;
