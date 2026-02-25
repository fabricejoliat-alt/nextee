-- Allow superadmin to fully manage organizations through RLS.

create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admins a
    where a.user_id = auth.uid()
  );
$$;

alter table if exists public.organizations enable row level security;

drop policy if exists "superadmin_can_read_organizations" on public.organizations;
create policy "superadmin_can_read_organizations"
on public.organizations
for select
to authenticated
using (public.is_superadmin());

drop policy if exists "superadmin_can_insert_organizations" on public.organizations;
create policy "superadmin_can_insert_organizations"
on public.organizations
for insert
to authenticated
with check (public.is_superadmin());

drop policy if exists "superadmin_can_update_organizations" on public.organizations;
create policy "superadmin_can_update_organizations"
on public.organizations
for update
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "superadmin_can_delete_organizations" on public.organizations;
create policy "superadmin_can_delete_organizations"
on public.organizations
for delete
to authenticated
using (public.is_superadmin());

