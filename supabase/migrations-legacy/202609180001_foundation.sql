-- Elts. foundation. No customer data is readable by anon or normal auth users.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.project_status as enum ('draft', 'editing', 'ready', 'expired', 'archived');
create type public.photography_type as enum ('wedding', 'prewedding', 'graduation', 'couple', 'event');
create type public.media_type as enum ('image', 'video');

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 120),
  created_at timestamptz not null default now()
);

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admins where user_id = (select auth.uid())); $$;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated, service_role;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 160),
  email text check (length(email) <= 254),
  phone text check (length(phone) <= 32),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  name text not null check (length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  photography_type public.photography_type not null,
  gallery_code text not null unique check (gallery_code ~ '^ELTS-[A-Z0-9]{8}$'),
  -- Versioned scrypt envelope: salt + hash, never a plaintext PIN.
  gallery_pin_hash text not null check (gallery_pin_hash ~ '^scrypt-v1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'),
  access_token text not null unique check (access_token ~ '^[A-Za-z0-9_-]{43}$'),
  shoot_date date,
  cover_media_id uuid,
  status public.project_status not null default 'draft',
  allow_download boolean not null default false,
  watermark_enabled boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_customer_id_idx on public.projects(customer_id);
create index projects_status_expiry_idx on public.projects(status, expires_at);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type public.media_type not null,
  file_name text not null check (length(file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  storage_provider text not null default 'supabase' check (storage_provider in ('supabase', 'cloudinary')),
  -- Stable private keys, not reusable public or signed URLs.
  original_key text not null unique,
  thumbnail_key text unique,
  preview_key text unique,
  watermarked_thumbnail_key text unique,
  watermarked_preview_key text unique,
  cloudinary_public_id text unique,
  width integer check (width > 0),
  height integer check (height > 0),
  file_size bigint not null check (file_size > 0),
  duration_seconds numeric check (duration_seconds > 0),
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  unique (project_id, id),
  check ((type = 'image' and mime_type like 'image/%') or (type = 'video' and mime_type like 'video/%')),
  check (storage_provider <> 'supabase' or original_key like project_id::text || '/%'),
  check (storage_provider <> 'supabase' or thumbnail_key is null or thumbnail_key like project_id::text || '/%'),
  check (storage_provider <> 'supabase' or preview_key is null or preview_key like project_id::text || '/%'),
  check (storage_provider <> 'supabase' or watermarked_thumbnail_key is null or watermarked_thumbnail_key like project_id::text || '/%'),
  check (storage_provider <> 'supabase' or watermarked_preview_key is null or watermarked_preview_key like project_id::text || '/%')
);
create index media_project_order_idx on public.media(project_id, sort_order, created_at);
-- Composite FK prevents cover selection from another customer's project.
alter table public.projects add constraint projects_cover_same_project_fk
  foreign key (id, cover_media_id) references public.media(project_id, id) on delete set null (cover_media_id)
  deferrable initially deferred;

create table private.gallery_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  gallery_access boolean not null default true,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, id),
  check (expires_at > created_at)
);
create index gallery_sessions_project_id_idx on private.gallery_sessions(project_id);
create index gallery_sessions_expiry_idx on private.gallery_sessions(expires_at);

create table public.favorites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  media_id uuid not null,
  session_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (project_id, media_id) references public.media(project_id, id) on delete cascade,
  -- Retain sessions after logout/expiry so customer selections are not deleted.
  foreign key (project_id, session_id) references private.gallery_sessions(project_id, id) on delete restrict,
  unique (session_id, media_id)
);
create index favorites_project_id_idx on public.favorites(project_id);
create index favorites_media_id_idx on public.favorites(media_id);
create index favorites_project_session_idx on public.favorites(project_id, session_id);

create table private.gallery_rate_limits (
  bucket_key text primary key check (length(bucket_key) <= 128),
  attempts integer not null check (attempts > 0),
  resets_at timestamptz not null
);
create index gallery_rate_limits_resets_idx on private.gallery_rate_limits(resets_at);

-- Persistent, atomic fixed window limiter. Invoke for BOTH HMAC(IP) and HMAC(code).
-- The handler must consume BOTH buckets before evaluating PIN, even on success.
create function public.consume_gallery_attempt(p_bucket_key text)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_resets_at timestamptz;
begin
  if p_bucket_key is null or length(p_bucket_key) not between 1 and 128 then
    raise exception 'Invalid rate limit key';
  end if;
  insert into private.gallery_rate_limits as limits (bucket_key, attempts, resets_at)
  values (p_bucket_key, 1, v_now + interval '10 minutes')
  on conflict (bucket_key) do update set
    attempts = case when limits.resets_at <= v_now then 1 else least(limits.attempts + 1, 1000000) end,
    resets_at = case when limits.resets_at <= v_now then v_now + interval '10 minutes' else limits.resets_at end
  returning attempts, resets_at into v_attempts, v_resets_at;
  return query select v_attempts <= 5, greatest(0, ceil(extract(epoch from v_resets_at - v_now))::integer);
end;
$$;
revoke all on function public.consume_gallery_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_gallery_attempt(text) to service_role;

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create trigger customers_updated_at before update on public.customers for each row execute function private.set_updated_at();
create trigger projects_updated_at before update on public.projects for each row execute function private.set_updated_at();

-- Editing access settings invalidates all prior gallery cookies immediately.
create function private.revoke_project_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.gallery_pin_hash is distinct from old.gallery_pin_hash
    or new.access_token is distinct from old.access_token
    or new.status is distinct from old.status
    or new.expires_at is distinct from old.expires_at then
    update private.gallery_sessions set revoked_at = now() where project_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$;
revoke all on function private.revoke_project_sessions() from public, anon, authenticated;
create trigger project_access_changed after update on public.projects for each row execute function private.revoke_project_sessions();

alter table public.admins enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.media enable row level security;
alter table public.favorites enable row level security;
alter table private.gallery_sessions enable row level security;
alter table private.gallery_rate_limits enable row level security;

revoke all on public.admins, public.customers, public.projects, public.media, public.favorites from anon, authenticated;
revoke all on private.gallery_sessions, private.gallery_rate_limits from public, anon, authenticated;
grant select on public.admins to authenticated;
grant select, insert, update, delete on public.customers, public.projects, public.media, public.favorites to authenticated;
grant all on public.admins, public.customers, public.projects, public.media, public.favorites,
  private.gallery_sessions, private.gallery_rate_limits to service_role;

create policy admins_read_self on public.admins for select to authenticated using (user_id = (select auth.uid()));
create policy customers_admin_all on public.customers for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy projects_admin_all on public.projects for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy media_admin_all on public.media for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy favorites_admin_all on public.favorites for all to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

comment on table public.media is 'Private storage keys only. Never return keys or original URLs in public DTOs.';
comment on table private.gallery_sessions is 'Server-only opaque sessions. Keep expired/revoked rows while favorites reference them.';
comment on column public.projects.access_token is 'Random URL locator, never an authorization credential.';
commit;
