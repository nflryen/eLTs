-- ============================================================================
-- ELTS STUDIO OS — RBAC ACCESS REPAIR
-- Migration: 0007_rbac_access_repair
-- ============================================================================
-- Resolves audit finding B2: RLS was silently OVER-DENYING.
--
-- 0001 granted `usage on schema private to authenticated`, but 0005 then ran
--   revoke all on schema private from public, anon, authenticated;
--   grant usage on schema private to service_role;
-- which REVOKED the grant 0001 had just made. Every RLS policy calls
-- `private.has_role_rank(...)`, so evaluation threw "permission denied for
-- schema private" and Postgres denied the row.
--
-- The application never noticed because 13 server actions use the service-role
-- client, which bypasses RLS entirely. That is finding B3. This migration makes
-- RLS FUNCTIONAL so that fixing B3 cannot silently open the data.
--
-- Applied as its own file, not by editing 0005: 0005 is already recorded in
-- schema_migrations on the hosted database, and rewriting applied history would
-- make the ledger disagree with what actually ran.

begin;

-- ── 1. Restore the schema grant ─────────────────────────────────────────────
-- USAGE on the schema is required before any function inside it can be
-- resolved. EXECUTE is granted separately and only on the helpers RLS needs.
grant usage on schema private to authenticated;

/*
 * Only the helpers policies actually evaluate are executable by `authenticated`.
 * The WRITE helpers (`set_updated_at`, `prevent_self_role_grant`,
 * `enforce_project_status_transition`) stay trigger-only: a client that could
 * call them directly could rewrite audit timestamps.
 */
grant execute on function private.has_role_rank(integer)   to authenticated;
grant execute on function private.current_role_rank()      to authenticated;
grant execute on function private.current_role()           to authenticated;
grant execute on function private.has_permission(text)     to authenticated;
grant execute on function private.is_admin()               to authenticated;

-- anon must never resolve role helpers: gallery sessions are token-scoped.
revoke all on schema private from anon;

-- ── 2. project_invoices: read >=80, write >=100 ─────────────────────────────
-- Already correct in 0006; re-asserted so this file is a complete statement of
-- the intended boundary and a later migration cannot weaken it unnoticed.
drop policy if exists project_invoices_rbac_read on public.project_invoices;
create policy project_invoices_rbac_read on public.project_invoices
  for select to authenticated using (private.has_role_rank(80));

drop policy if exists project_invoices_rbac_write on public.project_invoices;
create policy project_invoices_rbac_write on public.project_invoices
  for all to authenticated
  using (private.has_role_rank(100))
  with check (private.has_role_rank(100));

/*
 * Column-level protection for ADMIN (80): an ADMIN may READ an invoice but must
 * not be able to rewrite its money. RLS cannot express "read all columns, write
 * some", so the write path is closed at the privilege layer: `authenticated`
 * loses blanket UPDATE and regains only the columns an operator legitimately
 * maintains (status/notes), while the amount-bearing columns stay FOUNDER-only.
 *
 * NOTE: service_role keeps full access by design — it is the server's trusted
 * client and is no longer used for client-facing reads (see B3).
 */
revoke update on public.project_invoices from authenticated;
grant update (
  invoice_number, issue_date, due_date, client_notes,
  minimum_dp_pct, is_cancelled, updated_at
) on public.project_invoices to authenticated;

-- ── 3. inventory_assets: read >=60, manage >=80, report condition >=60 ──────
drop policy if exists inventory_assets_rbac_read on public.inventory_assets;
create policy inventory_assets_rbac_read on public.inventory_assets
  for select to authenticated using (private.has_role_rank(60));

drop policy if exists inventory_assets_rbac_write on public.inventory_assets;
create policy inventory_assets_rbac_write on public.inventory_assets
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

-- A WORKER may report condition on any asset they can see, but not value,
-- ownership or rental settings. Column privileges enforce that half.
drop policy if exists inventory_worker_condition on public.inventory_assets;
create policy inventory_worker_condition on public.inventory_assets
  for update to authenticated
  using (private.has_role_rank(60))
  with check (private.has_role_rank(60));

revoke update on public.inventory_assets from authenticated;
grant update (
  condition_status, notes, condition_reported_by, condition_reported_at, updated_at
) on public.inventory_assets to authenticated;

-- ── 4. editor_tasks: self-scoped for WORKER, full for ADMIN+ ────────────────
-- A WORKER may see their own task and move it forward. They may NOT reassign it
-- to someone else, which is why `with check` pins assigned_user_id to the
-- caller rather than merely permitting rank >= 60.
drop policy if exists editor_tasks_rbac_read on public.editor_tasks;
create policy editor_tasks_rbac_read on public.editor_tasks
  for select to authenticated
  using (
    private.has_role_rank(80)
    or (private.has_role_rank(60) and assigned_user_id = (select auth.uid()))
  );

drop policy if exists editor_tasks_rbac_write on public.editor_tasks;
create policy editor_tasks_rbac_write on public.editor_tasks
  for all to authenticated
  using (private.has_role_rank(80))
  with check (private.has_role_rank(80));

drop policy if exists editor_tasks_worker_self on public.editor_tasks;
create policy editor_tasks_worker_self on public.editor_tasks
  for update to authenticated
  using (
    private.has_role_rank(80)
    or (
      private.has_role_rank(60)
      and assigned_user_id is not null
      and assigned_user_id = (select auth.uid())
    )
  )
  with check (
    private.has_role_rank(80)
    or assigned_user_id = (select auth.uid())
  );

-- ── 5. Verify the helpers resolve for authenticated ─────────────────────────
-- A cheap self-check that fails the migration rather than leaving a silently
-- broken RLS layer in place.
do $$
declare
  v_ok boolean;
begin
  select has_schema_privilege('authenticated', 'private', 'USAGE') into v_ok;
  if not v_ok then
    raise exception 'private schema USAGE missing for authenticated (B2 regression)';
  end if;
  if not has_function_privilege('authenticated', 'private.has_role_rank(integer)', 'EXECUTE') then
    raise exception 'has_role_rank EXECUTE missing for authenticated (B2 regression)';
  end if;
end $$;

commit;
