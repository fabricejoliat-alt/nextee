-- v2 core model for multi-organization / multi-club structures
-- Non-breaking: adds new tables alongside existing schema.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  name text not null,
  org_type text not null check (org_type in ('club', 'academy', 'federation')),
  country_code text,
  region_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'coach', 'player', 'parent', 'captain', 'staff')),
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (organization_id, user_id, role)
);

create index if not exists organization_members_user_idx
  on public.organization_members (user_id, is_active);

create index if not exists organization_members_org_idx
  on public.organization_members (organization_id, is_active);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  program_type text not null check (program_type in ('junior_section', 'squad', 'camp', 'team', 'custom')),
  is_active boolean not null default true,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now()
);

create index if not exists programs_org_idx
  on public.programs (organization_id, is_active);

create table if not exists public.program_members (
  program_id uuid not null references public.programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('head_coach', 'coach', 'captain', 'player', 'parent', 'manager', 'staff')),
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  primary key (program_id, user_id, role)
);

create index if not exists program_members_user_idx
  on public.program_members (user_id, is_active);

create table if not exists public.player_guardians (
  player_id uuid not null references public.profiles(id) on delete cascade,
  guardian_user_id uuid not null references public.profiles(id) on delete cascade,
  relation text check (relation in ('mother', 'father', 'legal_guardian', 'other')),
  is_primary boolean not null default false,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (player_id, guardian_user_id)
);

create index if not exists player_guardians_guardian_idx
  on public.player_guardians (guardian_user_id);

-- Basic RLS activation (policies can be refined in subsequent migration).
alter table if exists public.organizations enable row level security;
alter table if exists public.organization_members enable row level security;
alter table if exists public.programs enable row level security;
alter table if exists public.program_members enable row level security;
alter table if exists public.player_guardians enable row level security;

drop policy if exists "org_members_can_read_organizations" on public.organizations;
create policy "org_members_can_read_organizations"
on public.organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organizations.id
      and om.user_id = auth.uid()
      and om.is_active = true
  )
);

drop policy if exists "users_can_read_org_members_they_belong_to" on public.organization_members;
create policy "users_can_read_org_members_they_belong_to"
on public.organization_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "program_members_can_read_programs" on public.programs;
create policy "program_members_can_read_programs"
on public.programs
for select
to authenticated
using (
  exists (
    select 1
    from public.program_members pm
    where pm.program_id = programs.id
      and pm.user_id = auth.uid()
      and pm.is_active = true
  )
);

drop policy if exists "program_members_can_read_program_members" on public.program_members;
create policy "program_members_can_read_program_members"
on public.program_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "guardian_or_player_can_read_guardian_links" on public.player_guardians;
create policy "guardian_or_player_can_read_guardian_links"
on public.player_guardians
for select
to authenticated
using (player_id = auth.uid() or guardian_user_id = auth.uid());
