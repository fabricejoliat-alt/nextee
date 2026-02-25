-- Fix RLS recursion on membership tables.
-- Root cause: policies querying the same table in USING clause.

alter table if exists public.organization_members enable row level security;
alter table if exists public.program_members enable row level security;
alter table if exists public.programs enable row level security;

-- Helpers (security definer) to avoid recursive RLS checks.
create or replace function public.is_org_captain(target_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = target_org_id
      and om.user_id = auth.uid()
      and om.role = 'captain'
      and om.is_active = true
  );
$$;

create or replace function public.is_program_in_captain_org(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.programs p
    join public.organization_members om
      on om.organization_id = p.organization_id
    where p.id = target_program_id
      and om.user_id = auth.uid()
      and om.role = 'captain'
      and om.is_active = true
  );
$$;

drop policy if exists "users_can_read_org_members_they_belong_to" on public.organization_members;
create policy "users_can_read_org_members_they_belong_to"
on public.organization_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_org_captain(organization_id)
);

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
  or public.is_org_captain(programs.organization_id)
);

drop policy if exists "program_members_can_read_program_members" on public.program_members;
create policy "program_members_can_read_program_members"
on public.program_members
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_program_in_captain_org(program_id)
);
