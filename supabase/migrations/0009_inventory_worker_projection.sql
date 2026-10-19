-- ============================================================================
-- ELTS STUDIO OS — WORKER GEAR PROJECTION
-- Migration: 0009_inventory_worker_projection
-- ============================================================================
-- The nav offers "Gear" to every WORKER, but `/admin/inventory` gated at ADMIN,
-- and `inventory_assets` exposed `daily_rental_rate` and `replacement_value` to
-- any authenticated reader. Opening the page without fixing that would hand a
-- WORKER the studio's asset valuation — a financial surface, not a production one.
--
-- A WORKER needs to know WHICH gear exists, whether it is in-house or rented
-- from a partner, and what condition it is in. They do not need what it is worth
-- or what it rents for.
--
-- WHY A VIEW AND NOT COLUMN GRANTS
-- --------------------------------
-- Postgres column grants are per ROLE, and every staff member is the same role
-- (`authenticated`). `grant select (cols) to authenticated` cannot distinguish
-- ADMIN from WORKER. So the split lives in a SECURITY DEFINER view that decides
-- per caller, which is the same granularity RLS uses everywhere else.
--
-- 0007 already revoked blanket UPDATE on this table and re-granted only the
-- condition columns, so valuation cannot be written by a WORKER either.

begin;

create or replace view public.v_inventory_assets_for_caller
with (security_invoker = false)
as
select
  -- Identity and production logistics: every staff member needs these.
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
  -- Electrical planning: a crew needs to know if a unit requires clean earth.
  a.power_draw_watts,
  a.power_peak_watts,
  a.requires_clean_earth,
  a.requires_ups,
  a.accessories_default,
  /*
   * Commercial columns resolve to NULL below ADMIN (rank 80). NULL rather than 0
   * so the field is absent from the payload instead of reading "worth nothing".
   */
  case when private.has_role_rank(80) then a.daily_rental_rate end            as daily_rental_rate,
  case when private.has_role_rank(80) then a.replacement_value end            as replacement_value,
  case when private.has_role_rank(80) then a.is_available_for_outgoing_rental end
                                                                              as is_available_for_outgoing_rental
from public.inventory_assets a
where private.has_role_rank(60);

comment on view public.v_inventory_assets_for_caller is
  'Inventory directory scoped to the caller. Valuation columns are NULL below ADMIN (rank 80).';

revoke all on public.v_inventory_assets_for_caller from public, anon;
grant select on public.v_inventory_assets_for_caller to authenticated, service_role;

do $$
begin
  if not has_table_privilege('authenticated', 'public.v_inventory_assets_for_caller', 'SELECT') then
    raise exception 'v_inventory_assets_for_caller not selectable by authenticated';
  end if;
end $$;

commit;
