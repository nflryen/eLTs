-- Apply after foundation migrations. Additive: no customer or media deletion.
begin;
alter table public.projects drop constraint if exists projects_gallery_pin_hash_check;
alter table public.projects add constraint projects_gallery_pin_hash_check
  check (gallery_pin_hash ~ '^scrypt-v[12]\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$');
alter table public.media add column if not exists cloudinary_delivery_type text;
alter table public.media drop constraint if exists media_cloudinary_delivery_type_check;
alter table public.media add constraint media_cloudinary_delivery_type_check
  check (cloudinary_delivery_type is null or cloudinary_delivery_type in ('upload', 'authenticated'));
comment on column public.media.cloudinary_delivery_type is 'NULL is legacy public delivery; new uploads must use authenticated.';

-- Server-only RPCs; keep the private schema unexposed. The verified hash must
-- still match under a lock so a concurrent PIN reset invalidates this login.
create or replace function public.create_gallery_session(
  p_project_id uuid, p_verified_pin_hash text, p_token_hash text,
  p_upgraded_pin_hash text default null
) returns table (session_id uuid, project_id uuid, access_token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_project public.projects%rowtype;
  v_session_id uuid;
  v_expires_at timestamptz;
begin
  select * into v_project from public.projects where id = p_project_id for update;
  if not found or v_project.gallery_pin_hash is distinct from p_verified_pin_hash
    or v_project.status <> 'ready'
    or (v_project.expires_at is not null and v_project.expires_at <= clock_timestamp()) then return; end if;
  if p_upgraded_pin_hash is not null then
    if p_upgraded_pin_hash !~ '^scrypt-v2\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$' then raise exception 'Invalid credential upgrade'; end if;
    update public.projects set gallery_pin_hash = p_upgraded_pin_hash where id = p_project_id;
  end if;
  v_expires_at := least(clock_timestamp() + interval '12 hours', coalesce(v_project.expires_at, 'infinity'::timestamptz));
  insert into private.gallery_sessions(project_id, token_hash, expires_at)
    values(p_project_id, p_token_hash, v_expires_at) returning id into v_session_id;
  return query select v_session_id, p_project_id, v_project.access_token, v_expires_at;
end;
$$;
create or replace function public.resolve_gallery_session(p_token_hash text)
returns table (session_id uuid, project_id uuid, access_token text, slug text, expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id, s.project_id, p.access_token, p.slug, least(s.expires_at, coalesce(p.expires_at, 'infinity'::timestamptz))
  from private.gallery_sessions s join public.projects p on p.id = s.project_id
  where s.token_hash = p_token_hash and s.gallery_access and s.revoked_at is null
    and s.expires_at > now() and p.status = 'ready'
    and (p.expires_at is null or p.expires_at > now());
$$;
create or replace function public.revoke_gallery_session(p_token_hash text)
returns void language sql security definer set search_path = '' as $$
  update private.gallery_sessions set revoked_at = now() where token_hash = p_token_hash and revoked_at is null;
$$;
revoke all on function public.create_gallery_session(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.resolve_gallery_session(text) from public, anon, authenticated;
revoke all on function public.revoke_gallery_session(text) from public, anon, authenticated;
grant execute on function public.create_gallery_session(uuid,text,text,text) to service_role;
grant execute on function public.resolve_gallery_session(text) to service_role;
grant execute on function public.revoke_gallery_session(text) to service_role;
notify pgrst, 'reload schema';
commit;
