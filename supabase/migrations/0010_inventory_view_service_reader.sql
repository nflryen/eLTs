-- ============================================================================
-- ELTS STUDIO OS — INVENTORY VIEW RETURNS ROWS FOR TRUSTED CLIENTS
-- Migration: 0010_inventory_view_service_reader
-- ============================================================================
-- Defect: `/admin/inventory` rendered 0 units while `inventory_assets` held 28
-- rows, and the table reported no error — a silent empty result.
--
-- Cause
-- -----
-- 0009 defined the view with `where private.has_role_rank(60)`. That helper
-- reads `auth.uid()`, which only exists on a request carrying a user JWT.
--
-- `RoleSession.supabase` (returned by `requireStaff()` / `requireOps()`) is the
-- SERVICE-ROLE client. It bypasses RLS and carries no JWT, so `auth.uid()` is
-- NULL, `current_role_rank()` is 0, and EVERY row was filtered out. Measured on
-- the hosted database:
--
--   service_role -> inventory_assets                    : 28 rows
--   service_role -> v_inventory_assets_for_caller       :  0 rows
--   authenticated (FOUNDER) -> v_inventory_assets_...   : 28 rows
--
-- So the view was correct for an end-user JWT and wrong for the server action
-- that actually calls it. A privileged reader is already past the guard: it was
-- admitted by `requireStaff()` before the query ran.
--
-- Fix
-- ---
-- Treat the absence of a caller identity as "trusted server connection" rather
-- than "rank 0 stranger", and keep the money-column split intact. `anon` still
-- sees nothing: it has no EXECUTE on the helpers and no JWT either, but it is
-- identified by `current_user`/role membership, not by a NULL uid alone.
-- Concretely the predicate becomes:
--
--   has_role_rank(60)            -- a real user with sufficient rank
--   OR is_service_reader()       -- a server-side connection with no JWT
--
-- `is_service_reader()` is deliberately narrow: it requires the connection to be
-- `service_role` (or a superuser) AND `auth.uid()` to be NULL. A request that
-- carries a JWT is always judged on that JWT, so a signed-in WORKER cannot
-- escalate by any means, and a bug that accidentally forwards a user JWT on the
-- service client still yields that user's real rank.

begin;

-- ── 1. Identify a trusted server-side reader ────────────────────────────────
create or replace function private.is_service_reader()
returns boolean
language sql
stable
set search_path = ''
as $$
  select
    -- No end-user identity on this connection...
    (select auth.uid()) is null
    -- ...and it is one of the privileged server roles.
    and (
      pg_catalog.pg_has_role(current_user, 'service_role', 'member')
      or (select rolsuper from pg_catalog.pg_roles where rolname = current_user)
    );
$$;

comment on function private.is_service_reader() is
  'True for a privileged server connection with no end-user JWT. Never true for anon/authenticated callers.';

revoke all on function private.is_service_reader() from public, anon, authenticated;
grant execute on function private.is_service_reader() to service_role;

-- ── 2. Access predicate shared by the view ─────────────────────────────────
create or replace function private.can_read_inventory()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_role_rank(60) or private.is_service_reader();
$$;

comment on function private.can_read_inventory() is
  'Row visibility for inventory: staff rank >= 60, or a trusted server connection.';

revoke all on function private.can_read_inventory() from public, anon;
grant execute on function private.can_read_inventory() to authenticated, service_role;

-- ── 3. Money split must survive for a server read ──────────────────────────
-- The valuation columns were gated on `has_role_rank(80)`, which is false for a
-- JWT-less server connection. Without this, fixing the row filter would have
-- blanked the price column the admin UI displays.
create or replace function private.can_read_inventory_valuation()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.has_role_rank(80) or private.is_service_reader();
$$;

revoke all on function private.can_read_inventory_valuation() from public, anon;
grant execute on function private.can_read_inventory_valuation() to authenticated, service_role;

-- ── 4. Rebuild the view ────────────────────────────────────────────────────
create or replace view public.v_inventory_assets_for_caller
with (security_invoker = false)
as
select
  a.id,
  a.asset_code,
  a.name,
  a.category,
  a.source_type,
  a.owner_name,
  a.vendor_name,
  a.vendor_phone,
  a.serial_number,
  a.condition_status,
  a.condition_reported_by,
  a.condition_reported_at,
  a.notes,
  a.created_at,
  a.updated_at,
  a.power_draw_watts,
  a.power_peak_watts,
  a.requires_clean_earth,
  a.requires_ups,
  a.accessories_default,
  case when private.can_read_inventory_valuation() then a.daily_rental_rate end            as daily_rental_rate,
  case when private.can_read_inventory_valuation() then a.replacement_value end            as replacement_value,
  case when private.can_read_inventory_valuation() then a.is_available_for_outgoing_rental end
                                                                                          as is_available_for_outgoing_rental
from public.inventory_assets a
where private.can_read_inventory();

comment on view public.v_inventory_assets_for_caller is
  'Inventory directory scoped to the caller. Valuation columns are NULL below ADMIN; trusted server connections see all columns.';

revoke all on public.v_inventory_assets_for_caller from public, anon;
grant select on public.v_inventory_assets_for_caller to authenticated, service_role;

-- ── 5. Self-check ──────────────────────────────────────────────────────────
/*
 * Asserts only what can be checked without switching role inside the migration
 * transaction (a `set_config('role', …)` here would leak into the caller's
 * session). Row counts are verified out-of-band by the release check:
 *
 *   service_role -> v_inventory_assets_for_caller   must be 28
 *   authenticated (WORKER) -> valuation columns     must be NULL
 *
 * What IS asserted: the predicate functions exist and `anon` cannot reach them.
 */
do $$
begin
  if not has_function_privilege('service_role', 'private.can_read_inventory()', 'EXECUTE') then
    raise exception 'service_role cannot execute private.can_read_inventory()';
  end if;
  if not has_function_privilege('authenticated', 'private.can_read_inventory()', 'EXECUTE') then
    raise exception 'authenticated cannot execute private.can_read_inventory()';
  end if;
  if has_function_privilege('anon', 'private.can_read_inventory()', 'EXECUTE') then
    raise exception 'anon must not execute private.can_read_inventory()';
  end if;
  if has_function_privilege('anon', 'private.is_service_reader()', 'EXECUTE') then
    raise exception 'anon must not execute private.is_service_reader()';
  end if;
end $$;

commit;
