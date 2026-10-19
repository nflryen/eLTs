# Hosted Supabase migration runbook

**Scope:** apply `0002_rbac_core`, `0003_rbac_policies`, `0004_studio_payment_methods`
to the hosted project.

**Verified state of the hosted database at time of writing:**

| Object | Present? |
|---|---|
| `public.admins` (2 rows) | ✅ |
| `public.project_invoices` (8 rows) | ✅ |
| `public.invoice_payment_receipts` | ✅ |
| `public.get_client_invoice_dto` | ✅ (still has hardcoded accounts) |
| `public.roles`, `public.role_assignments` | ❌ |
| `public.studio_payment_methods` | ❌ |
| `get_caller_role()`, `has_permission_for_caller()` | ❌ |
| `consume_gallery_attempt()`, `create_gallery_session()` | ❌ |

**Registered staff:**

| UUID | Email | Display name |
|---|---|---|
| `dc905281-fe32-4bf8-af9e-aac574f11f0c` | admin@elts.id | Rayyan Nufail |
| `8a251447-8b3e-4b82-a36b-613e6cd9af33` | admin@elts.com | Admin ELTs |

> ⚠️ **Read §0 before running anything.** The code currently falls back to
> `public.admins` membership when `get_caller_role()` is missing. That fallback
> resolves everyone to **ADMIN (80)** — nobody can be FOUNDER or SUPER_ADMIN
> until §3 is executed.

---

## 0. Safety prerequisites

1. **Take a backup.** Supabase Dashboard → Project Settings → Database →
   *Backups*, confirm a recent daily backup **or** enable PITR. These
   migrations are additive and create no data loss, but a rollback path that
   does not exist cannot be used.
2. **Open a transaction-capable console.** Use the Supabase **SQL Editor**
   (runs as `postgres`, bypasses RLS) — *not* the PostgREST API. Every script
   below opens its own `BEGIN` and closes with `COMMIT`; if any statement
   raises, nothing is applied.
3. **Do not run migrations during a deploy.** The application tolerates a
   missing 0002 (legacy fallback) but not a half-applied one. Run all three,
   in order, in one sitting.

---

## 1. Pre-flight

### 1a. Confirm the admin roster and your UUID

```sql
-- Who is currently an administrator, and do these map to real auth users?
select
  a.user_id,
  a.display_name,
  u.email,
  u.email_confirmed_at is not null as email_confirmed
from public.admins a
left join auth.users u on u.id = a.user_id
order by a.display_name;
```

**Expected:** both UUIDs above, with `email_confirmed = true`.
A row with `email IS NULL` means an admin record points at a deleted user —
resolve that before continuing, or the back-fill in §2 will carry a dead row.

### 1b. Confirm the migrations have not already been applied

```sql
select
  to_regclass('public.roles')            is not null as has_roles,
  to_regclass('public.role_assignments') is not null as has_assignments,
  to_regclass('public.studio_payment_methods') is not null as has_payment_methods,
  to_regprocedure('public.get_caller_role()')  is not null as has_caller_role;
```

**Expected right now:** all four `false`.
If `has_roles` is already `true`, **skip §2.1** — re-running is safe
(idempotent), but skip the back-fill comment so you do not miss existing data.

### 1c. Record your own UUID

```sql
-- Replace with your own login email if different.
select id as my_user_id, email
from auth.users
where email = 'admin@elts.id';
```

Copy the UUID — it is used in §3.

---

## 2. Migration order

Apply **exactly** in this order. Each step is its own transaction.

### 2.1 — `0002_rbac_core.sql`

Creates `roles`, `permissions`, `role_permissions`, `role_assignments`,
the authorization helpers, and the two application RPCs. Back-fills every
member of `public.admins` to **SUPER_ADMIN**.

```sql
BEGIN;

create table if not exists public.roles (
  key text primary key,
  label text not null,
  rank smallint not null unique,
  description text,
  is_staff boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.roles (key, label, rank, description, is_staff) values
  ('SUPER_ADMIN','Super Admin',           120,'Technical authority: system, migrations, RBAC, integrations.', true),
  ('FOUNDER',    'Founder / Studio Head', 100,'Business governance: P&L, treasury, splits, approvals.',       true),
  ('ADMIN',      'Operations Lead',        80,'Dispatch, scheduling, logistics, projects, invoicing.',        true),
  ('WORKER',     'Full-Time Creative',     60,'Assigned task execution, editor queue, uploads.',               true),
  ('FREELANCER', 'Field Crew',             30,'Magic-link call sheets, offers, fee slips. Not a login.',       false),
  ('CLIENT',     'Client',                 10,'Gallery and invoicing portal. Not a login.',                    false)
on conflict (key) do update
  set label = excluded.label, rank = excluded.rank,
      description = excluded.description, is_staff = excluded.is_staff;

create table if not exists public.permissions (
  key text primary key, description text not null, domain text not null
);

insert into public.permissions (key, description, domain) values
  ('project.read','View projects and their workspace','operations'),
  ('project.write','Create and edit projects','operations'),
  ('project.delete','Delete or archive a project','operations'),
  ('crew.read','View crew directory and assignments','operations'),
  ('crew.write','Assign crew and set fees','operations'),
  ('gear.read','View inventory catalogue','operations'),
  ('gear.write','Create and edit inventory assets','operations'),
  ('gear.delete','Delete an inventory asset','operations'),
  ('calendar.read','View the operations calendar','operations'),
  ('calendar.write','Create and edit calendar events','operations'),
  ('task.read','View editor queue tasks','operations'),
  ('task.write','Update assigned editor tasks','operations'),
  ('customer.read','View customer records','clients'),
  ('customer.write','Create and edit customer records','clients'),
  ('customer.archive','Archive a customer','clients'),
  ('gallery.manage','Manage gallery access, PINs and expiry','clients'),
  ('invoice.read','View commercial invoices','finance'),
  ('invoice.issue','Create and issue a client invoice','finance'),
  ('invoice.settle','Confirm payment, record receipts, void','finance'),
  ('expense.read','View project expenses','finance'),
  ('expense.write','Record a project expense','finance'),
  ('expense.approve','Approve a submitted expense','finance'),
  ('ledger.read','View the cash ledger','finance'),
  ('split.read','View waterfall profit splits','finance'),
  ('split.approve','Approve a waterfall profit split','finance'),
  ('payout.release','Release a payout','finance'),
  ('system.settings','Change studio/system settings','system'),
  ('system.rbac','Grant, revoke and override roles','system'),
  ('system.audit','Read technical audit logs','system'),
  ('system.telemetry','View system health and telemetry','system'),
  ('system.integration','Configure API keys, webhooks, integrations','system'),
  ('system.migration','Run database migrations','system'),
  ('system.flags','Toggle feature flags and maintenance mode','system')
on conflict (key) do update
  set description = excluded.description, domain = excluded.domain;

create table if not exists public.role_permissions (
  role_key text not null references public.roles(key) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_key, permission_key)
);

delete from public.role_permissions;

insert into public.role_permissions (role_key, permission_key)
select r.key, p.key
from public.roles r
join public.permissions p on true
where (r.key = 'SUPER_ADMIN')
   or (r.key = 'FOUNDER' and p.key in (
        'project.read','project.write','crew.read','gear.read','calendar.read',
        'task.read','customer.read','customer.write','customer.archive','gallery.manage',
        'invoice.read','invoice.issue','invoice.settle',
        'expense.read','expense.write','expense.approve',
        'ledger.read','split.read','split.approve','payout.release'))
   or (r.key = 'ADMIN' and p.key in (
        'project.read','project.write','crew.read','crew.write',
        'gear.read','gear.write','calendar.read','calendar.write',
        'task.read','customer.read','customer.write','gallery.manage',
        'invoice.read','invoice.issue','expense.read','expense.write'))
   or (r.key = 'WORKER' and p.key in (
        'project.read','crew.read','gear.read','calendar.read','task.read','task.write'));

create table if not exists public.role_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_key text not null references public.roles(key) on delete restrict,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at > granted_at)
);
create index if not exists role_assignments_role_idx
  on public.role_assignments (role_key) where revoked_at is null;

-- Back-fill: every existing admin becomes SUPER_ADMIN, so nobody loses access
-- when 0003 replaces the blanket is_admin() policies.
insert into public.role_assignments (user_id, role_key)
select user_id, 'SUPER_ADMIN' from public.admins
on conflict (user_id) do nothing;

create or replace function private.legacy_admin_rank() returns smallint
language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from public.admins where user_id = (select auth.uid())
  ) then 80::smallint else 0::smallint end;
$$;

create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select a.role_key from public.role_assignments a
      where a.user_id = (select auth.uid()) and a.revoked_at is null limit 1),
    case when private.legacy_admin_rank() > 0 then 'ADMIN' else null end);
$$;

-- An explicit assignment SUPERSEDES the legacy fallback (never greatest()).
create or replace function private.current_role_rank() returns smallint
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.rank from public.role_assignments a
       join public.roles r on r.key = a.role_key
      where a.user_id = (select auth.uid()) and a.revoked_at is null limit 1)::smallint,
    private.legacy_admin_rank());
$$;

create or replace function private.has_role_rank(p_min integer) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_role_rank() >= p_min;
$$;

create or replace function private.has_permission(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.role_assignments a
    join public.role_permissions rp on rp.role_key = a.role_key
    where a.user_id = (select auth.uid())
      and a.revoked_at is null and rp.permission_key = p_key);
$$;

revoke all on function private.current_role(), private.current_role_rank(),
  private.has_role_rank(integer), private.has_permission(text) from public, anon;
grant execute on function private.current_role(), private.current_role_rank(),
  private.has_role_rank(integer), private.has_permission(text)
  to authenticated, service_role;

alter table public.roles            enable row level security;
alter table public.permissions      enable row level security;
alter table public.role_permissions enable row level security;
alter table public.role_assignments enable row level security;

drop policy if exists roles_read_staff on public.roles;
create policy roles_read_staff on public.roles
  for select to authenticated using (private.has_role_rank(30));

drop policy if exists permissions_read_staff on public.permissions;
create policy permissions_read_staff on public.permissions
  for select to authenticated using (private.has_role_rank(30));

drop policy if exists role_permissions_read_staff on public.role_permissions;
create policy role_permissions_read_staff on public.role_permissions
  for select to authenticated using (private.has_role_rank(30));

drop policy if exists role_assignments_read_self on public.role_assignments;
create policy role_assignments_read_self on public.role_assignments
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists role_assignments_super_admin_write on public.role_assignments;
create policy role_assignments_super_admin_write on public.role_assignments
  for all to authenticated
  using (private.has_role_rank(120)) with check (private.has_role_rank(120));

create or replace function private.prevent_self_role_grant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id = (select auth.uid()) and new.role_key <> coalesce(old.role_key, '') then
    raise exception 'Self role escalation is not permitted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_role_grant on public.role_assignments;
create trigger trg_prevent_self_role_grant
  before insert or update on public.role_assignments
  for each row execute function private.prevent_self_role_grant();

create or replace view public.v_staff_directory as
select ra.user_id, ra.role_key, r.label as role_label, r.rank as role_rank,
       a.display_name, ra.granted_at, ra.revoked_at
from public.role_assignments ra
join public.roles r on r.key = ra.role_key
left join public.admins a on a.user_id = ra.user_id
where ra.revoked_at is null;

create or replace function public.get_caller_role()
returns table (role_key text, role_rank smallint, display_name text)
language sql stable security definer set search_path = '' as $$
  select private.current_role(), private.current_role_rank(),
    (select a.display_name from public.admins a where a.user_id = (select auth.uid()));
$$;

create or replace function public.has_permission_for_caller(p_permission_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission(p_permission_key);
$$;

revoke all on function public.get_caller_role() from public, anon;
revoke all on function public.has_permission_for_caller(text) from public, anon;
grant execute on function public.get_caller_role() to authenticated, service_role;
grant execute on function public.has_permission_for_caller(text) to authenticated, service_role;

COMMIT;
```

**Gate — do not continue unless this returns two rows, both `SUPER_ADMIN`:**

```sql
select ra.user_id, u.email, ra.role_key, r.rank
from public.role_assignments ra
join public.roles r on r.key = ra.role_key
left join auth.users u on u.id = ra.user_id
where ra.revoked_at is null;
```

### 2.2 — `0003_rbac_policies.sql`

Replaces the blanket `{table}_admin_all` policy on 19 tables with per-domain
read/write policies. Additive-then-subtractive: new policies are created
first, the legacy one is dropped last, all inside one transaction.

```sql
BEGIN;

do $$
declare
  spec text[]; read_rank integer; write_rank integer;
  t text; tbl_exists boolean;
  specs text[][] := array[
    ['projects','60','80'], ['media','60','80'],
    ['equipment_presets','60','80'], ['editor_tasks','60','80'],
    ['customers','80','80'], ['favorites','80','80'],
    ['crew_members','80','80'], ['project_crew_assignments','80','80'],
    ['inventory_assets','60','80'],
    ['project_expenses','100','100'], ['project_invoices','100','100'],
    ['invoice_payment_receipts','100','100'], ['money_splits','100','100'],
    ['cash_ledger','100','100'],
    ['vendor_purchase_orders','80','80'], ['vendor_purchase_order_items','80','80'],
    ['outgoing_rental_orders','80','80'], ['outgoing_rental_items','80','80'],
    ['document_sequences','80','80']
  ];
begin
  foreach spec slice 1 in array specs loop
    t := spec[1]; read_rank := spec[2]::integer; write_rank := spec[3]::integer;

    select exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) into tbl_exists;
    if not tbl_exists then
      raise notice 'rbac: skipping absent table public.%', t; continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t||'_rbac_read', t);
    execute format($f$ create policy %I on public.%I for select to authenticated
      using (private.has_role_rank(%s)) $f$, t||'_rbac_read', t, read_rank);

    execute format('drop policy if exists %I on public.%I', t||'_rbac_write', t);
    execute format($f$ create policy %I on public.%I for all to authenticated
      using (private.has_role_rank(%s)) with check (private.has_role_rank(%s)) $f$,
      t||'_rbac_write', t, write_rank, write_rank);

    execute format('drop policy if exists %I on public.%I', t||'_admin_all', t);
    raise notice 'rbac: public.% read>=% write>=%', t, read_rank, write_rank;
  end loop;
end $$;

do $$
declare r record; n integer;
begin
  for r in
    select c.relname from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
    where n2.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
      and c.relname in (
        'projects','media','customers','favorites','crew_members',
        'project_crew_assignments','equipment_presets','inventory_assets',
        'project_expenses','project_invoices','invoice_payment_receipts',
        'money_splits','cash_ledger','vendor_purchase_orders',
        'vendor_purchase_order_items','outgoing_rental_orders',
        'outgoing_rental_items','editor_tasks','document_sequences')
  loop
    select count(*) into n from pg_policies
      where schemaname='public' and tablename=r.relname;
    if n = 0 then
      raise exception 'rbac: public.% has RLS but NO policy', r.relname;
    end if;
    if exists (select 1 from pg_policies where schemaname='public'
               and tablename=r.relname and policyname=r.relname||'_admin_all') then
      raise exception 'rbac: legacy blanket policy still on public.%', r.relname;
    end if;
  end loop;
  raise notice 'rbac: policy verification passed';
end $$;

COMMIT;
```

### 2.3 — `0004_studio_payment_methods.sql`

Creates the payment table, seeds the current accounts **once**, and replaces
`get_client_invoice_dto` so bank details come from the table.

```sql
BEGIN;

create table if not exists public.studio_payment_methods (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null check (length(trim(bank_name)) between 1 and 60),
  account_number text not null check (account_number ~ '^[0-9]{6,32}$'),
  account_holder text not null check (length(trim(account_holder)) between 1 and 120),
  label text,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  unique (bank_name, account_number)
);
create index if not exists studio_payment_methods_active_idx
  on public.studio_payment_methods (is_active, sort_order) where is_active;
create unique index if not exists studio_payment_methods_one_primary_idx
  on public.studio_payment_methods ((is_primary)) where is_primary;

alter table public.studio_payment_methods enable row level security;

drop policy if exists studio_payment_methods_read on public.studio_payment_methods;
create policy studio_payment_methods_read on public.studio_payment_methods
  for select to authenticated using (private.has_role_rank(60));

drop policy if exists studio_payment_methods_write on public.studio_payment_methods;
create policy studio_payment_methods_write on public.studio_payment_methods
  for all to authenticated
  using (private.has_role_rank(80)) with check (private.has_role_rank(80));

insert into public.studio_payment_methods
  (bank_name, account_number, account_holder, is_primary, sort_order)
select * from (values
  ('BCA','3581216520','Emri Luthfan A.',true,10),
  ('Mandiri','1560023148218','Muhammad Rayyan Nufail',false,20)
) as v(bank_name, account_number, account_holder, is_primary, sort_order)
where not exists (select 1 from public.studio_payment_methods);

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

revoke all on function public.get_client_invoice_dto(text) from public;
grant execute on function public.get_client_invoice_dto(text)
  to anon, authenticated, service_role;

COMMIT;
```

> The function above contains **no account literals**. Bank details are read
> from `public.studio_payment_methods` on every call, and the result is `[]`
> when nothing is configured.

---

## 3. Role seed

After §2.1 the back-fill already made both admins `SUPER_ADMIN`. This step
makes the assignment explicit and records who granted it. Run it
**as a service/owner role** (SQL Editor) — RLS would otherwise block a
self-grant, and the trigger blocks self-escalation by design.

```sql
BEGIN;

-- Replace with your UUID from §1c.
\set my_uuid 'dc905281-fe32-4bf8-af9e-aac574f11f0c'

insert into public.role_assignments (user_id, role_key, granted_by)
values (:'my_uuid'::uuid, 'SUPER_ADMIN', :'my_uuid'::uuid)
on conflict (user_id) do update
  set role_key = excluded.role_key,
      revoked_at = null,
      granted_at = now();
COMMIT;
```

If your SQL Editor does not support `\set`, inline the UUID directly:

```sql
BEGIN;
insert into public.role_assignments (user_id, role_key, granted_by)
values ('dc905281-fe32-4bf8-af9e-aac574f11f0c', 'SUPER_ADMIN',
        'dc905281-fe32-4bf8-af9e-aac574f11f0c')
on conflict (user_id) do update
  set role_key = excluded.role_key, revoked_at = null, granted_at = now();
COMMIT;
```

> ⚠️ **The back-fill runs only at migration time.** Anyone added to
> `public.admins` *after* §2.1 resolves as legacy **ADMIN (80)**. See §5 for
> provisioning new staff.


**Verify (runs in the SQL Editor, where `auth.uid()` is null — use the
service-role bypass form below):**

```sql
-- Confirms the assignment exists and has rank 120.
select ra.user_id, u.email, ra.role_key, r.rank
from public.role_assignments ra
join public.roles r on r.key = ra.role_key
left join auth.users u on u.id = ra.user_id
where ra.user_id = 'dc905281-fe32-4bf8-af9e-aac574f11f0c';
```

**To prove `private.current_role()` returns `SUPER_ADMIN` as *that user***,
the check must run with their JWT, not the SQL Editor session:

```sql
-- Simulate the signed-in user inside a transaction, then roll back.
BEGIN;
set local request.jwt.claims = '{"sub":"dc905281-fe32-4bf8-af9e-aac574f11f0c","role":"authenticated"}';
set local role authenticated;
select
  current_setting('request.jwt.claims')::jsonb ->> 'sub' as acting_as,
  private.current_role()          as role,
  private.current_role_rank()     as rank,
  private.has_role_rank(120)      as is_super_admin;
ROLLBACK;
```

**Expected:** `SUPER_ADMIN | 120 | true`.

---

## 4. Post-migration verification

### 4a. Rank and policy dry-run

```sql
-- Rank matrix for every registered staff member.
select u.email, coalesce(ra.role_key,'(none)') as role,
       coalesce(r.rank, private.legacy_admin_rank()) as effective_rank
from auth.users u
left join public.role_assignments ra on ra.user_id = u.id and ra.revoked_at is null
left join public.roles r on r.key = ra.role_key
order by effective_rank desc nulls last;

-- Confirm the legacy blanket policies are gone and role policies are live.
select tablename, policyname
from pg_policies
where schemaname='public'
  and (policyname like '%\_admin\_all' or policyname like '%\_rbac\_%')
order by tablename, policyname;
```

**Expected:** no `%_admin_all` rows; two `_rbac_` policies per table.

### 4b. Confirm the PGRST202 fallback is no longer triggered

The application logs `rbac_not_applied` (from `src/lib/auth/roles.ts`) whenever
`get_caller_role()` is missing. After §2.1 that RPC exists, so the warning must
stop.

```sql
-- The RPC must resolve, not raise.
select public.get_caller_role();
```

**Expected:** one row (values depend on the calling session; in the SQL Editor
`auth.uid()` is null, so `role_key` is `null`, `role_rank` is `0`). A **PGRST202
/ "could not find the function"** error means §2.1 did not commit.

Then verify through the application, which is the real test:

1. Sign in at `/admin/login`.
2. Open the sidebar. As SUPER_ADMIN you should see **all nine** destinations,
   including *Treasury* and *Kru & Akses*.
3. The footer role label should read **Super Admin**, not "Operations Lead"
   (the legacy fallback label).
4. Browser console must show **no** `rbac_not_applied` warning.

### 4c. Payment accounts are live

```sql
select bank_name, account_number, account_holder, is_primary, is_active
from public.studio_payment_methods order by sort_order;
```

Then open any invoice and confirm the printed page and the WhatsApp copy both
show the accounts **from this table**. To prove the honest empty state, run:

```sql
BEGIN;
update public.studio_payment_methods set is_active = false;
select jsonb_pretty(
  public.get_client_invoice_dto((select invoice_number from public.project_invoices limit 1)) -> 'studio_bank_details'
) as bank_details_when_disabled;
ROLLBACK;
```

**Expected:** `[]` — an empty array, never a fallback account.

---

## 5. Provisioning staff after the migration

The §2.1 back-fill is a one-time event. A user added to `public.admins` later
has **no** `role_assignments` row and resolves through
`private.legacy_admin_rank()` at **ADMIN (80)** — not SUPER_ADMIN.

Always create the assignment explicitly:

```sql
BEGIN;

-- 1. The auth user must already exist (Supabase Auth → Users).
-- 2. Grant the role here; `granted_by` is your own UUID for the audit trail.
insert into public.role_assignments (user_id, role_key, granted_by)
values (
  'PUT-NEW-USER-UUID-HERE',
  'ADMIN',                       -- FOUNDER | ADMIN | WORKER | SUPER_ADMIN
  'dc905281-fe32-4bf8-af9e-aac574f11f0c'
)
on conflict (user_id) do update
  set role_key = excluded.role_key, revoked_at = null, granted_at = now();

COMMIT;
```

Verify:

```sql
select user_id, role_key, role_label, role_rank, granted_at
from public.v_staff_directory
order by role_rank desc, granted_at;
```

> The self-escalation trigger blocks `new.user_id = auth.uid()` when the role
> changes. Running this **in the SQL Editor** (where `auth.uid()` is null) is
> the supported path; a user cannot promote themselves through the API.

### Decommissioning the legacy fallback

Once every operator has an explicit assignment:

```sql
-- Must return 0 before removing the fallback.
select count(*) from public.admins a
left join public.role_assignments r on r.user_id = a.user_id
where r.user_id is null;
```

Then, and only then:

```sql
create or replace function private.legacy_admin_rank() returns smallint
language sql immutable as $$ select 0::smallint $$;
```

---

## Rollback

| Migration | Rollback |
|---|---|
| 0004 | `drop table public.studio_payment_methods;` then re-apply the old function from `0001` (it restores the hardcoded accounts — only do this if 0004 itself is faulty). |
| 0003 | Run `supabase/migrations/rollback/0003_down.sql`. Recreates `{table}_admin_all` from `private.is_admin()`, so ADMIN/FOUNDER/SUPER_ADMIN regain the pre-0003 access. Verified to restore ADMIN access to financial tables. |
| 0002 | Additive; safe to leave in place. The application degrades to the legacy `public.admins` check if `get_caller_role()` is absent. |

---

## Known gaps this runbook does **not** close

- `consume_gallery_attempt()` and `create_gallery_session()` are absent from the
  hosted database, so **client gallery login will fail** at
  `src/app/client/actions.ts`. 0001 defines them; the hosted project appears to
  predate those objects. Apply the relevant section of
  `0001_consolidated_studio_os.sql` before enabling the client portal.
- Apply `0002`–`0004` to a **staging** project first if one exists; the policy
  rewrite changes access for every table at once.
