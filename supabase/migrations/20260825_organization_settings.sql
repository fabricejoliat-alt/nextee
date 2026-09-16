-- Settings are kept separate from the core organization record so new options can
-- be introduced without repeatedly altering the organizations table.
create table if not exists public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

alter table public.organization_settings enable row level security;

-- Access is performed by the protected admin API. This policy only lets a member
-- read its own organization settings when the product needs it later.
drop policy if exists "organization_members_can_read_settings" on public.organization_settings;
create policy "organization_members_can_read_settings"
on public.organization_settings for select to authenticated
using (
  exists (
    select 1 from public.organization_members om
    where om.organization_id = organization_settings.organization_id
      and om.user_id = auth.uid() and om.is_active = true
  )
);
