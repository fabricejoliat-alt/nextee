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
