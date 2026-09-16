-- A group belongs to one season. Legacy groups are attached to the current
-- season so they remain available after this migration.
alter table public.coach_groups
  add column if not exists club_season_id uuid references public.club_seasons(id) on delete cascade,
  add column if not exists copied_from_group_id uuid references public.coach_groups(id) on delete set null;

create index if not exists coach_groups_season_idx on public.coach_groups (club_id, club_season_id);

update public.coach_groups g
set club_season_id = s.id
from public.club_seasons s
where s.club_id = g.club_id
  and s.is_current = true
  and g.club_season_id is null;

create or replace function public.copy_groups_to_new_season()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_season_id uuid;
begin
  select id into previous_season_id
  from public.club_seasons
  where club_id = new.club_id
    and id <> new.id
    and ends_on <= new.starts_on
  order by ends_on desc
  limit 1;

  if previous_season_id is null then return new; end if;

  insert into public.coach_groups (club_id, club_season_id, copied_from_group_id, name, is_active, head_coach_user_id, is_performance)
  select g.club_id, new.id, g.id, g.name, g.is_active,
    case when exists (
      select 1 from public.club_members cm
      left join public.club_coach_season_records csr on csr.club_member_id = cm.id and csr.club_season_id = previous_season_id
      where cm.club_id = new.club_id and cm.user_id = g.head_coach_user_id and cm.role = 'coach' and cm.is_active = true
        and coalesce(csr.registration_status, 'active') = 'active'
    ) then g.head_coach_user_id else null end,
    g.is_performance
  from public.coach_groups g
  where g.club_id = new.club_id and g.club_season_id = previous_season_id;

  insert into public.coach_group_categories (group_id, category)
  select copied.id, category.category
  from public.coach_group_categories category
  join public.coach_groups copied on copied.copied_from_group_id = category.group_id and copied.club_season_id = new.id;

  insert into public.coach_group_players (group_id, player_user_id)
  select copied.id, membership.player_user_id
  from public.coach_group_players membership
  join public.coach_groups copied on copied.copied_from_group_id = membership.group_id and copied.club_season_id = new.id
  join public.club_members cm on cm.user_id = membership.player_user_id and cm.club_id = new.club_id and cm.role = 'player' and cm.is_active = true
  left join public.club_player_season_records psr on psr.club_member_id = cm.id and psr.club_season_id = previous_season_id
  where coalesce(psr.registration_status, 'active') = 'active';

  insert into public.coach_group_coaches (group_id, coach_user_id, is_head)
  select copied.id, membership.coach_user_id, membership.is_head and copied.head_coach_user_id = membership.coach_user_id
  from public.coach_group_coaches membership
  join public.coach_groups copied on copied.copied_from_group_id = membership.group_id and copied.club_season_id = new.id
  join public.club_members cm on cm.user_id = membership.coach_user_id and cm.club_id = new.club_id and cm.role = 'coach' and cm.is_active = true
  left join public.club_coach_season_records csr on csr.club_member_id = cm.id and csr.club_season_id = previous_season_id
  where coalesce(csr.registration_status, 'active') = 'active';

  insert into public.club_coach_season_records (club_season_id, club_member_id, registration_status)
  select new.id, record.club_member_id, record.registration_status
  from public.club_coach_season_records record
  where record.club_season_id = previous_season_id
  on conflict (club_season_id, club_member_id) do nothing;

  return new;
end;
$$;

drop trigger if exists copy_groups_to_new_season on public.club_seasons;
create trigger copy_groups_to_new_season
after insert on public.club_seasons
for each row execute function public.copy_groups_to_new_season();
