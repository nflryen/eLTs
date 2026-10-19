begin;
-- Customer media never belongs in a public bucket.
-- Bucket-wide limit: 1 GB originals. The later upload API must cap photos at 50 MB.
-- Align the limit with your Supabase plan before enabling uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('gallery-originals', 'gallery-originals', false, 1073741824, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']),
  ('gallery-previews', 'gallery-previews', false, 10485760, array['image/jpeg', 'image/webp', 'image/avif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Only admin identities may access objects directly. Client sessions use the gateway.
create policy elts_admin_storage_select on storage.objects for select to authenticated
using (bucket_id in ('gallery-originals', 'gallery-previews') and (select private.is_admin()));
create policy elts_admin_storage_insert on storage.objects for insert to authenticated
with check (bucket_id in ('gallery-originals', 'gallery-previews') and (select private.is_admin()));
create policy elts_admin_storage_update on storage.objects for update to authenticated
using (bucket_id in ('gallery-originals', 'gallery-previews') and (select private.is_admin()))
with check (bucket_id in ('gallery-originals', 'gallery-previews') and (select private.is_admin()));
create policy elts_admin_storage_delete on storage.objects for delete to authenticated
using (bucket_id in ('gallery-originals', 'gallery-previews') and (select private.is_admin()));
commit;
