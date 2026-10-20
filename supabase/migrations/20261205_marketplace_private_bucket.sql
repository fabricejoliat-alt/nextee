-- Older installations created a public Marketplace bucket. Restrictive object
-- policies only protect downloads once the bucket itself is private.
-- Existing photos remain in place and are served through authorized signed URLs.
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace', 'marketplace', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;
commit;
