-- Enforce rule:
-- Any active player in an active performance group must have club_members.is_performance = true.

create or replace function public.sync_org_player_performance_from_groups(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org_id is null then
    return;
  end if;

  update public.club_members cm
  set is_performance = true
  where cm.club_id = p_org_id
    and cm.role = 'player'
    and cm.is_active = true
    and coalesce(cm.is_performance, false) = false
    and exists (
      select 1
      from public.coach_group_players gp
      join public.coach_groups g on g.id = gp.group_id
      where gp.player_user_id = cm.user_id
        and g.club_id = p_org_id
        and coalesce(g.is_active, true) = true
        and coalesce(g.is_performance, false) = true
    );
end;
$$;

grant execute on function public.sync_org_player_performance_from_groups(uuid) to authenticated;

create or replace function public.enforce_player_performance_on_group_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_table_name = 'coach_groups' then
    v_org := coalesce(new.club_id, old.club_id);
    perform public.sync_org_player_performance_from_groups(v_org);
    return coalesce(new, old);
  end if;

  if tg_table_name = 'coach_group_players' then
    select g.club_id
    into v_org
    from public.coach_groups g
    where g.id = coalesce(new.group_id, old.group_id);
    perform public.sync_org_player_performance_from_groups(v_org);
    return coalesce(new, old);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_enforce_player_performance_on_groups on public.coach_groups;
create trigger trg_enforce_player_performance_on_groups
after insert or update of is_performance, is_active, club_id on public.coach_groups
for each row execute function public.enforce_player_performance_on_group_change();

drop trigger if exists trg_enforce_player_performance_on_group_players on public.coach_group_players;
create trigger trg_enforce_player_performance_on_group_players
after insert or update or delete on public.coach_group_players
for each row execute function public.enforce_player_performance_on_group_change();

create or replace function public.enforce_player_performance_on_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'player'
     and new.is_active = true
     and coalesce(new.is_performance, false) = false
     and exists (
       select 1
       from public.coach_group_players gp
       join public.coach_groups g on g.id = gp.group_id
       where gp.player_user_id = new.user_id
         and g.club_id = new.club_id
         and coalesce(g.is_active, true) = true
         and coalesce(g.is_performance, false) = true
     ) then
    update public.club_members cm
    set is_performance = true
    where cm.id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_player_performance_on_membership on public.club_members;
create trigger trg_enforce_player_performance_on_membership
after insert or update of role, is_active, club_id, user_id, is_performance on public.club_members
for each row execute function public.enforce_player_performance_on_membership_change();

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

  if coalesce(p_enabled, false) = false and exists (
    select 1
    from public.coach_group_players gp
    join public.coach_groups g on g.id = gp.group_id
    where gp.player_user_id = p_player_id
      and g.club_id = p_org_id
      and coalesce(g.is_active, true) = true
      and coalesce(g.is_performance, false) = true
  ) then
    raise exception 'forced_by_performance_group';
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

-- Initial backfill: make sure current players in active performance groups are ON.
do $$
declare
  r record;
begin
  for r in
    select distinct g.club_id
    from public.coach_groups g
    where coalesce(g.is_active, true) = true
      and coalesce(g.is_performance, false) = true
  loop
    perform public.sync_org_player_performance_from_groups(r.club_id);
  end loop;
end $$;

