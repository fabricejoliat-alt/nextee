-- Move Coach training AI assistance from one club-wide switch to each Coach membership.
-- Clubs that already enabled the feature keep it enabled for their existing active coaches.

alter table public.club_members
  add column if not exists coach_training_assistance_enabled boolean not null default false;

update public.club_members membership
set coach_training_assistance_enabled = true
from public.training_volume_settings settings
where settings.organization_id = membership.club_id
  and settings.coach_training_assistance_enabled = true
  and membership.role = 'coach'
  and membership.is_active = true
  and membership.coach_training_assistance_enabled = false;

create or replace function public.is_coach_training_assistance_enabled_for_coach(
  p_organization_id uuid,
  p_coach_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select membership.coach_training_assistance_enabled
    from public.club_members membership
    where membership.club_id = p_organization_id
      and membership.user_id = p_coach_id
      and membership.role = 'coach'
      and membership.is_active = true
    limit 1
  ), false);
$$;

revoke all on function public.is_coach_training_assistance_enabled_for_coach(uuid, uuid) from public, anon;
grant execute on function public.is_coach_training_assistance_enabled_for_coach(uuid, uuid) to authenticated, service_role;

-- Compatibility for already-deployed database functions. Service-role mutations are
-- first authorized by the API with the two-argument function above. Authenticated
-- callers remain evaluated against their own Coach membership.
create or replace function public.is_coach_training_assistance_enabled(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role' then true
    else public.is_coach_training_assistance_enabled_for_coach(p_organization_id, auth.uid())
  end;
$$;

revoke all on function public.is_coach_training_assistance_enabled(uuid) from public, anon;
grant execute on function public.is_coach_training_assistance_enabled(uuid) to authenticated, service_role;

