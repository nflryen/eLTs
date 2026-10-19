-- Elts. + Kineva consolidation: Commercial, proofing quota, invoices, editor tasks, and inquiries.
begin;

-- 1. Extend projects with commercial and selection quota fields
alter table public.projects
  add column if not exists contract_value numeric default 0 check (contract_value >= 0),
  add column if not exists dp_amount numeric default 0 check (dp_amount >= 0),
  add column if not exists is_dp_paid boolean not null default false,
  add column if not exists is_fully_paid boolean not null default false,
  add column if not exists service_pillar text default 'VISUAL_CREATIVE',
  add column if not exists selection_quota_min integer not null default 15 check (selection_quota_min >= 0),
  add column if not exists selection_quota_max integer not null default 20,
  add column if not exists selection_locked_at timestamptz;

alter table public.projects drop constraint if exists projects_selection_quota_check;
alter table public.projects add constraint projects_selection_quota_check
  check (selection_quota_max >= selection_quota_min);

-- 2. Invoices table
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  invoice_number text not null unique,
  milestone text not null check (milestone in ('DP_50', 'FINAL_BALANCE', 'ADDON')),
  amount numeric not null check (amount >= 0),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'PAID', 'CANCELLED')),
  due_date date,
  paid_at timestamptz,
  pdf_url text,
  created_at timestamptz not null default now()
);

create index if not exists invoices_project_id_idx on public.invoices(project_id);
create index if not exists invoices_status_idx on public.invoices(status);

-- 3. Editor tasks table
create table if not exists public.editor_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  assigned_editor_id text,
  status text not null default 'PENDING' check (status in ('PENDING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED')),
  deliverable_count integer not null default 0 check (deliverable_count >= 0),
  notes text,
  manifest_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists editor_tasks_project_id_idx on public.editor_tasks(project_id);
create index if not exists editor_tasks_status_idx on public.editor_tasks(status);

create trigger editor_tasks_updated_at
  before update on public.editor_tasks
  for each row execute function private.set_updated_at();

-- 4. Inquiries table
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  brand_name text,
  email text check (email is null or length(email) <= 254),
  phone text not null check (length(phone) between 1 and 32),
  pillar text not null,
  budget_range text,
  message text not null,
  status text not null default 'NEW' check (status in ('NEW', 'CONTACTED', 'QUOTED', 'CONVERTED', 'ARCHIVED')),
  source_page text,
  created_at timestamptz not null default now()
);

create index if not exists inquiries_status_created_idx on public.inquiries(status, created_at desc);

-- 5. Stored procedure for photo selection submission
create or replace function public.submit_photo_selection(
  p_project_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects%rowtype;
  v_count integer;
  v_now timestamptz := clock_timestamp();
  v_task_id uuid;
  v_manifest jsonb;
begin
  -- Lock project row to prevent race conditions during selection submission
  select * into v_project
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'Project not found';
  end if;

  if v_project.selection_locked_at is not null then
    raise exception 'Photo selection is already locked';
  end if;

  -- Validate that session is valid and belongs to the project
  if not exists (
    select 1
    from private.gallery_sessions
    where id = p_session_id
      and project_id = p_project_id
      and gallery_access
      and revoked_at is null
      and expires_at > v_now
  ) then
    raise exception 'Invalid or expired gallery session';
  end if;

  -- Count user favorites for this project and session
  select count(*)::integer into v_count
  from public.favorites
  where project_id = p_project_id
    and session_id = p_session_id;

  -- Validate against project quota boundaries
  if v_count < v_project.selection_quota_min then
    raise exception 'Selection count % is below minimum quota of %', v_count, v_project.selection_quota_min;
  end if;

  if v_count > v_project.selection_quota_max then
    raise exception 'Selection count % exceeds maximum quota of %', v_count, v_project.selection_quota_max;
  end if;

  -- Lock the project selection
  update public.projects
  set selection_locked_at = v_now,
      updated_at = v_now
  where id = p_project_id;

  -- Build manifest JSON of selected items
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'media_id', f.media_id,
        'file_name', m.file_name,
        'mime_type', m.mime_type,
        'original_key', m.original_key,
        'storage_provider', m.storage_provider
      ) order by m.sort_order, f.created_at
    ),
    '[]'::jsonb
  ) into v_manifest
  from public.favorites f
  join public.media m on m.id = f.media_id
  where f.project_id = p_project_id
    and f.session_id = p_session_id;

  -- Create editor task for fulfillment
  insert into public.editor_tasks (
    project_id,
    status,
    deliverable_count,
    notes,
    manifest_json,
    created_at,
    updated_at
  ) values (
    p_project_id,
    'PENDING',
    v_count,
    'Client selection submitted via gallery proofing.',
    v_manifest,
    v_now,
    v_now
  ) returning id into v_task_id;

  return jsonb_build_object(
    'success', true,
    'task_id', v_task_id,
    'deliverable_count', v_count,
    'locked_at', v_now
  );
end;
$$;

revoke all on function public.submit_photo_selection(uuid, uuid) from public, anon;
grant execute on function public.submit_photo_selection(uuid, uuid) to authenticated, service_role;

-- 6. Row Level Security policies
alter table public.invoices enable row level security;
alter table public.editor_tasks enable row level security;
alter table public.inquiries enable row level security;

revoke all on public.invoices, public.editor_tasks, public.inquiries from anon, authenticated;
grant select, insert, update, delete on public.invoices, public.editor_tasks to authenticated;
grant insert on public.inquiries to anon, authenticated;
grant select, update, delete on public.inquiries to authenticated;
grant all on public.invoices, public.editor_tasks, public.inquiries to service_role;

create policy invoices_admin_all on public.invoices
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy editor_tasks_admin_all on public.editor_tasks
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy inquiries_admin_all on public.inquiries
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy inquiries_public_insert on public.inquiries
  for insert to anon, authenticated
  with check (true);

comment on table public.invoices is 'Commercial invoices for milestone payments (DP_50, FINAL_BALANCE, ADDON).';
comment on table public.editor_tasks is 'Fulfillment tasks dispatched upon client photo selection submission.';
comment on table public.inquiries is 'Lead intake form submissions across commercial service pillars.';
comment on function public.submit_photo_selection(uuid, uuid) is 'Validates favorites against quota, locks project selection, and dispatches editor task.';

notify pgrst, 'reload schema';
commit;
