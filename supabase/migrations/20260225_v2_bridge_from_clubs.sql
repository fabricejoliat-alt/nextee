-- v2 bridge migration:
-- 1) Backfills organizations from existing clubs
-- 2) Backfills organization_members from club_members
-- 3) Adds optional links on existing entities for progressive cutover

alter table if exists public.coach_groups
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists program_id uuid references public.programs(id) on delete set null;

alter table if exists public.club_events
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists program_id uuid references public.programs(id) on delete set null;

-- Organizations from clubs (id intentionally reused for a smooth transition)
insert into public.organizations (id, slug, name, org_type, is_active)
select c.id, null, c.name, 'club', true
from public.clubs c
on conflict (id) do update
set name = excluded.name,
    is_active = true;

-- Map legacy club roles to organization roles
insert into public.organization_members (organization_id, user_id, role, is_active)
select
  cm.club_id as organization_id,
  cm.user_id,
  case
    when cm.role = 'manager' then 'manager'
    when cm.role = 'coach' then 'coach'
    when cm.role = 'player' then 'player'
    else 'staff'
  end as role,
  coalesce(cm.is_active, true) as is_active
from public.club_members cm
on conflict (organization_id, user_id, role) do update
set is_active = excluded.is_active;

-- Default "Section Junior" program for each club-org
insert into public.programs (organization_id, name, program_type, is_active)
select o.id, 'Section Junior', 'junior_section', true
from public.organizations o
where o.org_type = 'club'
  and not exists (
    select 1
    from public.programs p
    where p.organization_id = o.id
      and p.name = 'Section Junior'
  );

-- Link existing groups/events to organization_id (same as legacy club_id)
update public.coach_groups cg
set organization_id = cg.club_id
where cg.organization_id is null;

update public.club_events ce
set organization_id = ce.club_id
where ce.organization_id is null;

create index if not exists coach_groups_org_idx on public.coach_groups (organization_id);
create index if not exists coach_groups_program_idx on public.coach_groups (program_id);
create index if not exists club_events_org_idx on public.club_events (organization_id);
create index if not exists club_events_program_idx on public.club_events (program_id);
