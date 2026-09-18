-- Public profile photos. Each authenticated user may only manage files in
-- their own top-level folder: avatars/{auth.uid()}/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile avatars are publicly readable" on storage.objects;
create policy "profile avatars are publicly readable"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "users can upload their own profile avatar" on storage.objects;
create policy "users can upload their own profile avatar"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users can update their own profile avatar" on storage.objects;
create policy "users can update their own profile avatar"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users can delete their own profile avatar" on storage.objects;
create policy "users can delete their own profile avatar"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
