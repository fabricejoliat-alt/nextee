-- Public illustrations for the validation exercise catalogue.
-- Files are uploaded only through the super-admin API route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('validation-exercise-images', 'validation-exercise-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
