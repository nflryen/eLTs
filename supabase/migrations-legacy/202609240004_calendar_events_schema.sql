-- Studio Calendar Events Schema (Discovery calls, pre-production, field shoots, deadlines)
begin;

create table if not exists public.studio_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_type text not null check (event_type in ('DISCOVERY_CALL', 'PRE_PRODUCTION', 'FIELD_SHOOT', 'DEADLINE')),
  client_name text,
  client_phone text,
  client_email text,
  service_interest text,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  project_id uuid references public.projects(id) on delete set null,
  assigned_crew_ids text[],
  google_event_id text,
  meet_link text,
  notes text,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz not null default now()
);

-- Indexes for performance on time range lookups and filtering
create index if not exists studio_events_start_end_idx on public.studio_events(start_time, end_time);
create index if not exists studio_events_status_idx on public.studio_events(status);
create index if not exists studio_events_event_type_idx on public.studio_events(event_type);
create index if not exists studio_events_project_id_idx on public.studio_events(project_id);
create index if not exists studio_events_google_id_idx on public.studio_events(google_event_id);

-- Row Level Security
alter table public.studio_events enable row level security;

revoke all on public.studio_events from anon, authenticated;
grant select, insert on public.studio_events to anon, authenticated;
grant update, delete on public.studio_events to authenticated;
grant all on public.studio_events to service_role;

-- Admin access policy
create policy studio_events_admin_all on public.studio_events
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Public view policy for slot checking (only scheduled/active events)
create policy studio_events_public_select on public.studio_events
  for select to anon, authenticated
  using (status != 'CANCELLED');

-- Public insert policy for self-serve client bookings
create policy studio_events_public_insert on public.studio_events
  for insert to anon, authenticated
  with check (status = 'SCHEDULED');

comment on table public.studio_events is 'Studio calendar events for discovery calls, client meetings, shoots, and deadlines with Google Meet integration.';

notify pgrst, 'reload schema';
commit;
