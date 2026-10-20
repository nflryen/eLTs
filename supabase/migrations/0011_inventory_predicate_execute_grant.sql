-- ============================================================================
-- ELTS STUDIO OS — INVENTORY VIEW: GRANT EXECUTE ON THE PREDICATE
-- Migration: 0011_inventory_predicate_execute_grant
-- ============================================================================
-- Regression introduced by 0010.
--
-- 0010 rebuilt `v_inventory_assets_for_caller` so it would also return rows for
-- the service-role client, and revoked EXECUTE on the new helpers from
-- `authenticated`:
--
--   revoke all on function private.is_service_reader() from public, anon, authenticated;
--
-- That revoke is what broke the normal, JWT-carrying path. The view is
-- `security_invoker = false`, but a SECURITY DEFINER view changes the privileges
-- used to READ THE BASE TABLE — the functions in its WHERE list are still
-- evaluated with the CALLER's privileges. So a FOUNDER hitting the view got:
--
--   permission denied for function is_service_reader
--
-- and therefore 0 rows. Measured before this migration:
--
--   service_role  -> v_inventory_assets_for_caller : 28 rows
--   authenticated (FOUNDER, rank 120)              :  0 rows  <- wrong
--   anon                                           :  denied  <- correct
--
-- Why granting EXECUTE to `authenticated` is safe
-- ----------------------------------------------
-- `is_service_reader()` returns true only when BOTH conditions hold:
--
--   1. `auth.uid()` IS NULL  (no end-user identity on the connection), and
--   2. `current_user` is `service_role` (or a superuser).
--
-- An `authenticated` connection always has an identity, so condition (1) is
-- false and the function returns false regardless of the grant. Granting EXECUTE
-- only stops the permission ERROR; it cannot turn into an access grant. `anon`
-- stays revoked: gallery sessions are token-scoped and must never resolve role
-- helpers.

begin;

grant execute on function private.is_service_reader() to authenticated;

-- `anon` must keep failing, and must keep failing with a PRIVILEGE error rather
-- than by silently reading 0 rows.
revoke all on function private.is_service_reader() from public, anon;

-- ── Self-check ──────────────────────────────────────────────────────────────
do $$
begin
  if not has_function_privilege('authenticated', 'private.is_service_reader()', 'EXECUTE') then
    raise exception '0011 regression: authenticated cannot execute private.is_service_reader()';
  end if;
  if not has_function_privilege('service_role', 'private.is_service_reader()', 'EXECUTE') then
    raise exception '0011 regression: service_role cannot execute private.is_service_reader()';
  end if;
  if has_function_privilege('anon', 'private.is_service_reader()', 'EXECUTE') then
    raise exception '0011 regression: anon must not execute private.is_service_reader()';
  end if;
end $$;

commit;
