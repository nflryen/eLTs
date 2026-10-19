-- ============================================================================
-- ROLLBACK for 0003_rbac_policies
-- ============================================================================
-- Restores the pre-RBAC authorization model: the blanket `{table}_admin_all`
-- policy driven by `private.is_admin()`.
--
-- `private.is_admin()` is retained by 0002 and redefined as `rank >= 80`, so
-- after this rollback every ADMIN, FOUNDER and SUPER_ADMIN regains the access
-- they had before 0003. No data is modified.
--
-- USE ONLY IF 0003 must be reverted. Prefer rolling forward.
-- ============================================================================

begin;

do $$
declare
  t     text;
  names text[] := array[
    'customers','projects','media','favorites','crew_members',
    'project_crew_assignments','equipment_presets','inventory_assets',
    'project_expenses','project_invoices','invoice_payment_receipts',
    'vendor_purchase_orders','vendor_purchase_order_items',
    'outgoing_rental_orders','outgoing_rental_items',
    'money_splits','cash_ledger','editor_tasks','document_sequences'
  ];
  tbl_exists boolean;
begin
  foreach t in array names loop
    select exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) into tbl_exists;
    if not tbl_exists then continue; end if;

    -- Re-create the legacy blanket policy FIRST so the table is never open.
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using ((select private.is_admin()))
        with check ((select private.is_admin()))
    $f$, t || '_admin_all', t);

    -- Now remove the role-aware policies.
    execute format('drop policy if exists %I on public.%I', t || '_rbac_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_rbac_write', t);
  end loop;
end $$;

commit;
