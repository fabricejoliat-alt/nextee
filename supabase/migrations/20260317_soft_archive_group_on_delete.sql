-- Robust group "delete":
-- keep the group row as a hidden archive to avoid FK/trigger issues on coach_groups delete,
-- while removing future planning and group-scoped messaging.

create or replace function public.coach_group_delete_keep_history(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_head uuid;
  v_club_id uuid;
  v_can_delete boolean := false;
  v_group_name text;
  v_archived_name text;
begin
  if p_group_id is null then
    raise exception 'Missing group id';
  end if;

  select g.head_coach_user_id, g.club_id, g.name
  into v_head, v_club_id, v_group_name
  from public.coach_groups g
  where g.id = p_group_id;

  if v_head is null or v_club_id is null then
    raise exception 'Group not found';
  end if;

  select exists (
    select 1
    from public.club_members cm
    where cm.club_id = v_club_id
      and cm.user_id = v_uid
      and cm.is_active = true
      and cm.role = 'manager'
  )
  into v_can_delete;

  if not v_can_delete then
    raise exception 'Only a manager can delete this group';
  end if;

  -- Preserve coach visibility on past events before removing group staff links.
  insert into public.club_event_coaches (event_id, coach_id)
  select
    e.id as event_id,
    c.coach_user_id as coach_id
  from public.club_events e
  join public.coach_group_coaches c
    on c.group_id = p_group_id
  where e.group_id = p_group_id
    and e.starts_at < now()
    and not exists (
      select 1
      from public.club_event_coaches ec
      where ec.event_id = e.id
        and ec.coach_id = c.coach_user_id
    );

  -- Delete event threads before deleting future events.
  delete from public.message_threads t
  using public.club_events e
  where t.event_id = e.id
    and e.group_id = p_group_id
    and e.starts_at >= now();

  -- Delete future events of the group.
  delete from public.club_events e
  where e.group_id = p_group_id
    and e.starts_at >= now();

  -- Delete any thread linked to the group before clearing memberships/categories.
  delete from public.message_threads
  where group_id = p_group_id;

  delete from public.coach_group_categories where group_id = p_group_id;
  delete from public.coach_group_players where group_id = p_group_id;
  delete from public.coach_group_coaches where group_id = p_group_id;

  -- Hide the group from all lists instead of deleting the row.
  v_archived_name := '__ARCHIVE_DELETED__ ' || coalesce(nullif(trim(v_group_name), ''), 'Groupe') || ' [' || p_group_id::text || ']';

  update public.coach_groups
  set
    name = v_archived_name,
    is_active = false
  where id = p_group_id;

  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'club_event_series'
      and c.column_name = 'group_id'
  ) then
    execute 'delete from public.club_event_series where group_id = $1'
    using p_group_id;
  end if;
end;
$$;

grant execute on function public.coach_group_delete_keep_history(uuid) to authenticated;
