-- Make performance mode global across organizations for a player.
-- If a player is performance-enabled in one org, they are enabled in all active org memberships.

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

  -- 1) Force ON in current org for players in active performance groups.
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

  -- 2) Global propagation: any player ON in this org is ON in all active org memberships.
  update public.club_members cm_all
  set is_performance = true
  where cm_all.role = 'player'
    and cm_all.is_active = true
    and coalesce(cm_all.is_performance, false) = false
    and exists (
      select 1
      from public.club_members cm_src
      where cm_src.user_id = cm_all.user_id
        and cm_src.club_id = p_org_id
        and cm_src.role = 'player'
        and cm_src.is_active = true
        and coalesce(cm_src.is_performance, false) = true
    );
end;
$$;

grant execute on function public.sync_org_player_performance_from_groups(uuid) to authenticated;

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
     and (
       -- user already performance-enabled in another active membership
       exists (
         select 1
         from public.club_members cm
         where cm.user_id = new.user_id
           and cm.id <> new.id
           and cm.role = 'player'
           and cm.is_active = true
           and coalesce(cm.is_performance, false) = true
       )
       -- or forced by any active performance group in this org
       or exists (
         select 1
         from public.coach_group_players gp
         join public.coach_groups g on g.id = gp.group_id
         where gp.player_user_id = new.user_id
           and g.club_id = new.club_id
           and coalesce(g.is_active, true) = true
           and coalesce(g.is_performance, false) = true
       )
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

  -- Cannot disable if forced by at least one active performance group in any org.
  if coalesce(p_enabled, false) = false and exists (
    select 1
    from public.coach_group_players gp
    join public.coach_groups g on g.id = gp.group_id
    where gp.player_user_id = p_player_id
      and coalesce(g.is_active, true) = true
      and coalesce(g.is_performance, false) = true
  ) then
    raise exception 'forced_by_performance_group';
  end if;

  -- Global setting across all active player memberships.
  update public.club_members cm
  set is_performance = coalesce(p_enabled, false)
  where cm.user_id = p_player_id
    and cm.role = 'player'
    and cm.is_active = true;

  if not found then
    raise exception 'player_membership_not_found';
  end if;
end;
$$;

grant execute on function public.set_player_performance_mode(uuid, uuid, boolean) to authenticated;

-- Backfill global ON for players already ON in at least one active org membership.
update public.club_members cm_all
set is_performance = true
where cm_all.role = 'player'
  and cm_all.is_active = true
  and coalesce(cm_all.is_performance, false) = false
  and exists (
    select 1
    from public.club_members cm_src
    where cm_src.user_id = cm_all.user_id
      and cm_src.role = 'player'
      and cm_src.is_active = true
      and coalesce(cm_src.is_performance, false) = true
  );

