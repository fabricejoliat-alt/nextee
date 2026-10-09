begin;
-- Single public-facing contact mailbox, editable only through the platform Admin API.
create table if not exists public.platform_contact_settings (
  singleton boolean primary key default true check (singleton),
  contact_email text not null check (contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id)
);
insert into public.platform_contact_settings (singleton, contact_email)
values (true, 'info@activitee.golf')
on conflict (singleton) do nothing;
alter table public.platform_contact_settings enable row level security;
revoke all on public.platform_contact_settings from public, anon, authenticated;
grant select, update on public.platform_contact_settings to service_role;

-- Tables added after the security rollout need the same session gates.
drop policy if exists application_session_gate on public.platform_contact_settings;
create policy application_session_gate on public.platform_contact_settings as restrictive for all to authenticated
  using ((select public.application_session_ready())) with check ((select public.application_mutation_ready()));
drop policy if exists application_update_gate on public.platform_contact_settings;
create policy application_update_gate on public.platform_contact_settings as restrictive for update to authenticated
  using ((select public.application_mutation_ready())) with check ((select public.application_mutation_ready()));
drop policy if exists application_delete_gate on public.platform_contact_settings;
create policy application_delete_gate on public.platform_contact_settings as restrictive for delete to authenticated
  using ((select public.application_mutation_ready()));
notify pgrst,'reload schema';
commit;
