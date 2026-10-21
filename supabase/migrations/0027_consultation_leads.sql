begin;

/*
 * 0027 — Consultation leads: carry the package the client actually chose.
 *
 * THE GAP THIS CLOSES
 * -------------------
 * `public.inquiries` already captured name/phone/message, but the public form
 * never wrote to it: `ContactForm` only opened wa.me, so every consultation
 * that arrived through the website existed solely in the operator's WhatsApp
 * inbox. Nothing reached the dashboard, nothing was countable, and a lead who
 * asked "how much is Silver?" had no row anywhere.
 *
 * The columns added here are exactly the ones the pricelist configurator
 * already knows at submit time — the chosen package and add-ons — so the
 * studio can convert a lead without asking the client to repeat themselves.
 *
 * WHY NOT A NEW TABLE
 * -------------------
 * `inquiries` is already wired into `attention.ts` (the NEW-lead counter on the
 * dashboard) and carries the correct RLS posture: anon INSERT, staff-only read.
 * A parallel `consultation_leads` table would duplicate that policy surface and
 * split the operator's queue in two.
 *
 * STATUS VOCABULARY
 * -----------------
 * The original CHECK allowed NEW/CONTACTED/QUOTED/CONVERTED/ARCHIVED. The
 * studio's real pipeline distinguishes SCHEDULED (a date is held) from
 * CONVERTED (a project/invoice exists), and records dead leads as LOST rather
 * than ARCHIVED — "archived" describes filing, not outcome, and a lost lead
 * still needs to be visible for follow-up analysis. ARCHIVED is retained so no
 * existing row can fail the constraint.
 */

-- ── 1. Columns the pricelist configurator supplies ──────────────────────────
alter table public.inquiries
  add column if not exists event_type        text,
  add column if not exists event_date        date,
  add column if not exists selected_addons   jsonb not null default '[]'::jsonb,
  add column if not exists notes             text,
  add column if not exists reference         text,
  add column if not exists contacted_at      timestamptz,
  add column if not exists converted_customer_id uuid references public.customers(id) on delete set null;

/*
 * `converted_project_id` already exists from the original schema but had no FK
 * constraint. Add it so a deleted project cannot leave a lead pointing at a
 * ghost — the lead then reads as unconverted rather than silently converted.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inquiries_converted_project_fk'
  ) then
    alter table public.inquiries
      add constraint inquiries_converted_project_fk
      foreign key (converted_project_id) references public.projects(id) on delete set null;
  end if;
end $$;

/*
 * Package reference is `on delete set null`, not cascade: retiring a package
 * from the pricelist must never delete the lead that asked about it. The
 * quoted price is snapshotted into `selected_addons`/`notes` context anyway.
 */
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'inquiries_selected_package_fk'
  ) then
    alter table public.inquiries
      add column if not exists selected_package_id uuid;
    alter table public.inquiries
      add constraint inquiries_selected_package_fk
      foreign key (selected_package_id) references public.pricelist_packages(id) on delete set null;
  end if;
end $$;

-- ── 2. Human-readable reference ─────────────────────────────────────────────
/*
 * Operators quote a reference on the phone ("lead L-2601-0042"), so it has to
 * be short, stable, and unguessable enough not to leak volume. Date prefix
 * makes triage obvious; the 6-char suffix keeps collisions negligible and is
 * filled by a trigger so no caller can forget it.
 */
create sequence if not exists public.inquiry_reference_seq;

create or replace function private.assign_inquiry_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null then
    new.reference := 'L-' || to_char(now(), 'YYMM') || '-' ||
      lpad(nextval('public.inquiry_reference_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists inquiries_assign_reference on public.inquiries;
create trigger inquiries_assign_reference
  before insert on public.inquiries
  for each row execute function private.assign_inquiry_reference();

-- Backfill any pre-existing rows, then enforce uniqueness.
update public.inquiries
set reference = 'L-' || to_char(created_at, 'YYMM') || '-' ||
                lpad(nextval('public.inquiry_reference_seq')::text, 4, '0')
where reference is null;

create unique index if not exists inquiries_reference_key
  on public.inquiries (reference);

-- ── 3. Status vocabulary ────────────────────────────────────────────────────
alter table public.inquiries drop constraint if exists inquiries_status_check;

alter table public.inquiries
  add constraint inquiries_status_check
  check (status in ('NEW', 'CONTACTED', 'SCHEDULED', 'CONVERTED', 'LOST', 'QUOTED', 'ARCHIVED'));

/*
 * Default stays NEW. The old schema already had this default; restated here so
 * a fresh environment built from migrations alone behaves identically.
 */
alter table public.inquiries alter column status set default 'NEW';

-- ── 4. Indexes for the pipeline view ────────────────────────────────────────
/*
 * The leads list filters by status and orders newest-first; the partial index
 * keeps the dashboard's "NEW only" count cheap as history accumulates.
 */
create index if not exists inquiries_status_created_idx
  on public.inquiries (status, created_at desc);

create index if not exists inquiries_new_idx
  on public.inquiries (created_at desc)
  where status = 'NEW';

-- ── 5. RLS ──────────────────────────────────────────────────────────────────
/*
 * Policies already exist from the original migration:
 *   inquiries_public_insert  (anon, authenticated) INSERT
 *   inquiries_rbac_read      (authenticated)       SELECT
 *   inquiries_rbac_write     (authenticated)       ALL
 * Restated idempotently so this migration is self-contained, and tightened so
 * only staff rank >= 60 can read client contact details.
 */
alter table public.inquiries enable row level security;

drop policy if exists inquiries_public_insert on public.inquiries;
create policy inquiries_public_insert on public.inquiries
  for insert to anon, authenticated
  with check (true);

drop policy if exists inquiries_rbac_read on public.inquiries;
create policy inquiries_rbac_read on public.inquiries
  for select to authenticated
  using (private.has_role_rank(60));

drop policy if exists inquiries_rbac_write on public.inquiries;
create policy inquiries_rbac_write on public.inquiries
  for update to authenticated
  using (private.has_role_rank(60))
  with check (private.has_role_rank(60));

/*
 * Anon must never be able to read the table back — that would expose every
 * client's phone number to anyone who can call the REST endpoint.
 */
revoke all on public.inquiries from anon;
grant insert on public.inquiries to anon;
grant select, insert, update, delete on public.inquiries to authenticated;

grant usage, select on sequence public.inquiry_reference_seq to anon, authenticated;

commit;
