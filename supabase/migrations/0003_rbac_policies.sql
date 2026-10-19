-- ============================================================================
-- ELTS STUDIO OS — ROLE-AWARE RLS POLICIES
-- Migration: 0003_rbac_policies
-- ============================================================================
-- Replaces the blanket `{table}_admin_all` policies created in 0001, which
-- granted every admin-only table to anyone passing `private.is_admin()`.
--
-- SAFETY MODEL
-- ------------
-- Additive-then-subtractive. For each table the new role-aware policies are
-- created FIRST, and the legacy `{table}_admin_all` policy is dropped LAST,
-- inside the same transaction. Postgres evaluates all permissive policies with
-- OR, so during the transition a table is never left without a policy and never
-- briefly over-exposed.
--
-- To roll back: run `migrations/rollback/0003_down.sql`, which re-creates
-- `{table}_admin_all` from `private.is_admin()` (still defined as rank >= 80).
--
-- RANK MAPPING (from 0002)
--   120 SUPER_ADMIN · 100 FOUNDER · 80 ADMIN · 60 WORKER · 30 FREELANCER
--
-- DOMAIN ASSIGNMENT
--   operations  read >= WORKER(60)   write >= ADMIN(80)
--   clients     read >= ADMIN(80)    write >= ADMIN(80)
--   finance     read >= FOUNDER(100) write >= FOUNDER(100)
--   system      >= SUPER_ADMIN(120)
-- ============================================================================

begin;

-- ── 1. Per-table role-aware policy generator ───────────────────────────────
-- Each row is: table | read_rank | write_rank
do $$
declare
  spec       text[];
  specs      text[][] := array[
    -- operations: crew can see the work they are part of; leads manage it
    ['projects',                '60',  '80'],
    ['media',                   '60',  '80'],
    ['equipment_presets',       '60',  '80'],
    ['editor_tasks',            '60',  '80'],
    -- clients
    ['customers',               '80',  '80'],
    ['favorites',               '80',  '80'],
    ['crew_members',            '80',  '80'],
    ['project_crew_assignments','80',  '80'],
    ['gallery_access_log',      '80',  '80'],
    -- resources
    ['inventory_assets',        '60',  '80'],
    -- finance: FOUNDER only. ADMIN may issue invoices through the guarded
    -- server action, but the table itself is not readable to rank < 100.
    ['project_expenses',        '100', '100'],
    ['project_invoices',        '100', '100'],
    ['invoice_payment_receipts','100', '100'],
    ['money_splits',            '100', '100'],
    ['cash_ledger',             '100', '100'],
    ['vendor_purchase_orders',  '80',  '80'],
    ['vendor_purchase_order_items','80','80'],
    ['outgoing_rental_orders',  '80',  '80'],
    ['outgoing_rental_items',   '80',  '80'],
    ['document_sequences',      '80',  '80']
  ];
  t          text;
  read_rank  integer;
  write_rank integer;
  tbl_exists boolean;
begin
  foreach spec slice 1 in array specs loop
    t          := spec[1];
    read_rank  := spec[2]::integer;
    write_rank := spec[3]::integer;

    -- Skip tables absent from this database rather than failing the migration.
    select exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) into tbl_exists;
    if not tbl_exists then
      raise notice 'rbac: skipping absent table public.%', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- (a) CREATE the new read policy
    execute format('drop policy if exists %I on public.%I', t || '_rbac_read', t);
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (private.has_role_rank(%s))
    $f$, t || '_rbac_read', t, read_rank);

    -- (b) CREATE the new write policy
    execute format('drop policy if exists %I on public.%I', t || '_rbac_write', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (private.has_role_rank(%s))
        with check (private.has_role_rank(%s))
    $f$, t || '_rbac_write', t, write_rank, write_rank);

    -- (c) DROP the legacy blanket policy LAST
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);

    raise notice 'rbac: public.% → read>=% write>=%', t, read_rank, write_rank;
  end loop;
end $$;

-- ── 2. `admins` retains self-read; add SUPER_ADMIN management ───────────────
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'admins' and c.relkind = 'r'
  ) then
    execute 'drop policy if exists admins_read_self on public.admins';
    execute $f$
      create policy admins_read_self on public.admins
        for select to authenticated
        using (user_id = (select auth.uid()) or private.has_role_rank(120))
    $f$;
    execute 'drop policy if exists admins_system_write on public.admins';
    execute $f$
      create policy admins_system_write on public.admins
        for all to authenticated
        using (private.has_role_rank(120))
        with check (private.has_role_rank(120))
    $f$;
  end if;
end $$;

-- ── 3. Verify no admin-only table was left unprotected ──────────────────────
do $$
declare
  r      record;
  n      integer;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n2 on n2.oid = c.relnamespace
    where n2.nspname = 'public' and c.relkind = 'r'
      and c.relrowsecurity = true
      and c.relname in (
        'projects','media','customers','favorites','crew_members',
        'project_crew_assignments','equipment_presets','inventory_assets',
        'project_expenses','project_invoices','invoice_payment_receipts',
        'money_splits','cash_ledger','vendor_purchase_orders',
        'vendor_purchase_order_items','outgoing_rental_orders',
        'outgoing_rental_items','editor_tasks','document_sequences'
      )
  loop
    select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = r.relname;

    if n = 0 then
      raise exception 'rbac: table public.% has RLS enabled but NO policy', r.relname;
    end if;

    -- Assert the legacy blanket policy is gone.
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = r.relname
        and policyname = r.relname || '_admin_all'
    ) then
      raise exception 'rbac: legacy blanket policy still present on public.%', r.relname;
    end if;
  end loop;
  raise notice 'rbac: policy verification passed';
end $$;

commit;
