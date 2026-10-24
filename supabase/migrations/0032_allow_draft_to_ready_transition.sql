-- ── Allow draft -> ready project status transition ───────────────────────────
-- The project creation wizard ("Luncurkan Workspace Proyek") transitions the
-- newly scaffolded project directly from 'draft' to 'ready'.
-- Update the status state machine trigger to permit draft -> ready (and reverse).

create or replace function private.enforce_project_status_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case
    when old.status = 'draft'    and new.status in ('editing','ready','expired')            then true
    when old.status = 'editing'  and new.status in ('draft','ready','expired')              then true
    when old.status = 'ready'    and new.status in ('draft','editing','archived','expired') then true
    when old.status = 'archived' and new.status in ('ready')                                then true
    when old.status = 'expired'  and new.status in ('archived')                             then true
    else false
  end;

  if not allowed then
    raise exception 'Invalid project status transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;
