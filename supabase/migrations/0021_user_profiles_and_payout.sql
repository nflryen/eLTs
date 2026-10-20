begin;

/*
 * 0021 — Canonical self-service profile, payout destination, and the
 *        challenge RPC for payout changes.
 *
 * WHY A NEW TABLE
 * ---------------
 * Identity is currently split across `public.admins(display_name)` and
 * `public.crew_members(full_name, phone, bank_*)`, both keyed to `auth.users`.
 * `ray@elts.id` exists in both; `admin@elts.com` only in `admins`;
 * `fajar.crew@elts.id` only in `crew_members`. A settings page with two
 * possible sources of truth cannot be correct. `user_profiles` becomes the
 * single canonical identity record; `crew_members` stays as the assignment
 * record (role title, availability) and `admins` stays as the staff marker.
 */

create table if not exists public.user_profiles (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  full_name           text not null
    check (length(btrim(full_name)) between 1 and 120),
  display_name        text
    check (display_name is null or length(btrim(display_name)) between 1 and 60),
  phone               text
    check (phone is null or phone ~ '^\+?[0-9][0-9\-\s]{6,19}$'),
  avatar_url          text,

  /* Payout destination. Required for automated payslips. */
  payout_method       text
    check (payout_method is null or payout_method in ('BANK', 'EWALLET')),
  bank_name           text,
  bank_account_holder text,
  bank_account_number text,
  ewallet_provider    text,
  ewallet_id          text,

  /*
   * Payout is all-or-nothing per method. A half-filled bank record would make
   * `generate_payroll_cycle` emit a payslip with no valid destination, which is
   * discovered at payment time rather than at entry time.
   */
  constraint user_profiles_payout_complete check (
    (payout_method is null
      and bank_name is null and bank_account_holder is null and bank_account_number is null
      and ewallet_provider is null and ewallet_id is null)
    or (payout_method = 'BANK'
      and bank_name is not null and bank_account_holder is not null and bank_account_number is not null)
    or (payout_method = 'EWALLET'
      and ewallet_provider is not null and ewallet_id is not null)
  ),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_profiles is
  'Canonical self-service identity and payout destination, one row per account.';

alter table public.user_profiles enable row level security;

/*
 * A user reads and writes only their own row. FOUNDER may READ others (needed
 * to pay people) but never write them — an operator who can silently redirect
 * a colleague's bank account is the exact fraud this feature must prevent.
 */
drop policy if exists user_profiles_read_self on public.user_profiles;
create policy user_profiles_read_self on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role_rank(100));

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self on public.user_profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop trigger if exists user_profiles_updated_at on public.user_profiles;
create trigger user_profiles_updated_at
  before update on public.user_profiles
  for each row execute function private.set_updated_at();

-- ── Backfill from the two legacy identity tables ────────────────────────────
insert into public.user_profiles (user_id, full_name, display_name, phone)
select
  u.id,
  coalesce(nullif(btrim(cm.full_name), ''), a.display_name, u.email, 'Tanpa Nama'),
  a.display_name,
  nullif(btrim(cm.phone), '')
from auth.users u
left join public.crew_members cm on cm.auth_user_id = u.id
left join public.admins      a  on a.user_id      = u.id
where cm.id is not null or a.user_id is not null
on conflict (user_id) do nothing;

-- Carry over any existing bank details from the crew record.
update public.user_profiles p
   set payout_method       = 'BANK',
       bank_name           = cm.bank_name,
       bank_account_holder = cm.bank_account_holder,
       bank_account_number = cm.bank_account_number
  from public.crew_members cm
 where cm.auth_user_id = p.user_id
   and nullif(btrim(cm.bank_name), '') is not null
   and nullif(btrim(cm.bank_account_number), '') is not null
   and nullif(btrim(cm.bank_account_holder), '') is not null
   and p.payout_method is null;

/*
 * Payout changes are a financial event. Reuse the same token primitive as role
 * elevation: the application verifies the password, mints a token scoped to
 * 'PAYOUT_CHANGE', and this function consumes it before allowing the update.
 *
 * Implemented as a table of its own rather than overloading
 * role_challenge_tokens, because that table's `target_role` is a FK to
 * public.roles and 'PAYOUT_CHANGE' is not a role.
 */
create table if not exists public.payout_challenge_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.payout_challenge_tokens enable row level security;

create or replace function public.mint_payout_challenge_token(p_user_id uuid)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  insert into public.payout_challenge_tokens (user_id, expires_at)
  values (p_user_id, now() + interval '5 minutes')
  returning id into v_token;
  return v_token;
end $$;

revoke all on function public.mint_payout_challenge_token(uuid) from public, anon, authenticated;
grant execute on function public.mint_payout_challenge_token(uuid) to service_role;

/*
 * Applies a payout change only with a valid, unexpired, single-use token.
 * The token is consumed atomically, so a replay cannot redirect a second time.
 */
create or replace function public.update_payout_with_challenge(
  p_token               uuid,
  p_payout_method       text,
  p_bank_name           text,
  p_bank_account_holder text,
  p_bank_account_number text,
  p_ewallet_provider    text,
  p_ewallet_id          text
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_ok    boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  update public.payout_challenge_tokens t
     set consumed_at = now()
   where t.id = p_token
     and t.user_id = v_uid
     and t.consumed_at is null
     and t.expires_at > now()
  returning true into v_ok;

  if not coalesce(v_ok, false) then
    raise exception 'Password confirmation required to change payout details'
      using errcode = 'insufficient_privilege';
  end if;

  update public.user_profiles
     set payout_method       = p_payout_method,
         bank_name           = p_bank_name,
         bank_account_holder = p_bank_account_holder,
         bank_account_number = p_bank_account_number,
         ewallet_provider    = p_ewallet_provider,
         ewallet_id          = p_ewallet_id
   where user_id = v_uid;

  return true;
end $$;

revoke all on function public.update_payout_with_challenge(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_payout_with_challenge(uuid, text, text, text, text, text, text) to authenticated, service_role;

commit;
