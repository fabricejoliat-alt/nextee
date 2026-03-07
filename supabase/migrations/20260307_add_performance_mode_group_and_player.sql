-- Performance mode flags (group + individual player override)
-- Rules:
-- - Group performance ON => all players in that group are effectively performance-enabled.
-- - Group performance OFF => player can still be performance-enabled individually.

alter table if exists public.coach_groups
  add column if not exists is_performance boolean not null default false;

alter table if exists public.club_members
  add column if not exists is_performance boolean not null default false;

create index if not exists idx_coach_groups_club_performance
  on public.coach_groups (club_id, is_performance);

create index if not exists idx_club_members_perf_player
  on public.club_members (club_id, user_id, role, is_active, is_performance);

create or replace function public.is_player_performance_enabled(
  p_org_id uuid,
  p_player_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    exists (
      select 1
      from public.coach_groups g
      join public.coach_group_players gp
        on gp.group_id = g.id
       and gp.player_user_id = p_player_id
      where g.club_id = p_org_id
        and coalesce(g.is_active, true) = true
        and coalesce(g.is_performance, false) = true
    )
    or exists (
      select 1
      from public.club_members cm
      where cm.club_id = p_org_id
        and cm.user_id = p_player_id
        and cm.role = 'player'
        and cm.is_active = true
        and coalesce(cm.is_performance, false) = true
    )
  );
$$;

grant execute on function public.is_player_performance_enabled(uuid, uuid) to authenticated;

create or replace function public.set_player_performance_mode(
  p_org_id uuid,
  p_player_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null or p_player_id is null then
    raise exception 'missing_arguments';
  end if;

  if not public.is_org_staff_member(p_org_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  update public.club_members cm
  set is_performance = coalesce(p_enabled, false)
  where cm.club_id = p_org_id
    and cm.user_id = p_player_id
    and cm.role = 'player'
    and cm.is_active = true;

  if not found then
    raise exception 'player_membership_not_found';
  end if;
end;
$$;

grant execute on function public.set_player_performance_mode(uuid, uuid, boolean) to authenticated;

