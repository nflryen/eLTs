begin;

/*
 * 0022 — Session listing and revocation RPCs.
 *
 * `auth.sessions` is not exposed to PostgREST, so the Security tab cannot read
 * it directly. These SECURITY DEFINER wrappers resolve the actor from
 * `auth.uid()` and expose only the caller's own sessions.
 */

create or replace function public.list_my_sessions()
returns table (
  session_id     uuid,
  created_at     timestamptz,
  updated_at     timestamptz,
  active_role    text,
  elevated_until timestamptz
)
language sql stable security definer set search_path = '' as $$
  select
    s.id,
    s.created_at,
    s.updated_at,
    c.active_role,
    c.elevated_until
  from auth.sessions s
  left join public.user_session_context c on c.session_id = s.id
  where s.user_id = (select auth.uid())
  order by s.created_at desc
  limit 50;
$$;

revoke all on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated, service_role;

/*
 * Revokes ONE session belonging to the caller.
 *
 * The `user_id = auth.uid()` predicate is the authorization check: a caller
 * cannot revoke someone else's session even if they know the id. Deleting the
 * session row cascades to `user_session_context`, so any elevation held in that
 * session disappears with it.
 */
create or replace function public.revoke_my_session(p_session_id uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  delete from auth.sessions
   where id = p_session_id
     and user_id = v_uid;

  if not found then
    raise exception 'Session not found' using errcode = 'no_data_found';
  end if;

  return true;
end $$;

revoke all on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated, service_role;

commit;
