-- Ensure group players are added as attendees when staff creates events.

create or replace function public.staff_seed_group_players_attendees(p_event_id uuid)
returns table(player_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_allowed boolean;
begin
  select e.group_id
  into v_group_id
  from public.club_events e
  where e.id = p_event_id;

  if v_group_id is null then
    raise exception 'event_not_found';
  end if;

  select exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = v_group_id
      and (
        g.head_coach_user_id = auth.uid()
        or cgc.coach_user_id is not null
        or cm.user_id is not null
      )
  )
  into v_allowed;

  if coalesce(v_allowed, false) = false then
    raise exception 'forbidden';
  end if;

  insert into public.club_event_attendees (event_id, player_id, status)
  select p_event_id, gp.player_user_id, 'present'
  from public.coach_group_players gp
  where gp.group_id = v_group_id
    and not exists (
      select 1
      from public.club_event_attendees a
      where a.event_id = p_event_id
        and a.player_id = gp.player_user_id
    );

  return query
  select a.player_id
  from public.club_event_attendees a
  where a.event_id = p_event_id;
end;
$$;

grant execute on function public.staff_seed_group_players_attendees(uuid) to authenticated;
