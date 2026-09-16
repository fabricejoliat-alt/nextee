-- Public media bucket used by Marketplace listings.
-- The API uploads with the service role, while these policies preserve the
-- authenticated client-side edit flow for the listing owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace', 'marketplace', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketplace images are publicly readable" on storage.objects;
create policy "marketplace images are publicly readable"
on storage.objects for select
using (bucket_id = 'marketplace');

drop policy if exists "users can upload their marketplace images" on storage.objects;
create policy "users can upload their marketplace images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users can update their marketplace images" on storage.objects;
create policy "users can update their marketplace images"
on storage.objects for update to authenticated
using (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "users can delete their marketplace images" on storage.objects;
create policy "users can delete their marketplace images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'marketplace'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
