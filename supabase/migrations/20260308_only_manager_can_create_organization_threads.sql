-- Restrict organization threads creation: only manager can create.

create or replace function public.can_create_message_thread(
  p_org_id uuid,
  p_thread_type text,
  p_group_id uuid,
  p_event_id uuid,
  p_player_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_org_id is null or p_user_id is null then
    return false;
  end if;

  if p_thread_type = 'organization' then
    return public.is_org_manager_member(p_org_id, p_user_id);
  end if;

  if p_thread_type = 'group' then
    return p_group_id is not null
      and public.is_group_staff_member(p_group_id, p_user_id);
  end if;

  if p_thread_type = 'event' then
    return p_event_id is not null
      and exists (
        select 1
        from public.club_events e
        where e.id = p_event_id
          and e.club_id = p_org_id
          and (
            public.is_org_staff_member(p_org_id, p_user_id)
            or public.is_group_staff_member(e.group_id, p_user_id)
          )
      );
  end if;

  if p_thread_type = 'player' then
    return p_player_id is not null
      and public.is_org_staff_member(p_org_id, p_user_id)
      and exists (
        select 1
        from public.club_members cm
        where cm.club_id = p_org_id
          and cm.user_id = p_player_id
          and cm.is_active = true
          and cm.role = 'player'
      );
  end if;

  return false;
end;
$$;
