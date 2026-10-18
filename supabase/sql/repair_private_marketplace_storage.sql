-- Restore the missing production image bucket without making uploaded photos public.
-- Marketplace image upload, removal and signed links use the authorized server APIs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace', 'marketplace', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'marketplace';
