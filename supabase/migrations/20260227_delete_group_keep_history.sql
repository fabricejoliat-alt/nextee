-- Delete a coach group safely:
-- - delete future events of the group
-- - keep past events by moving them to an archive group (group_id is NOT NULL)
-- - then delete group memberships/categories/group row atomically

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
  v_archive_group_id uuid;
begin
  if p_group_id is null then
    raise exception 'Missing group id';
  end if;

  select g.head_coach_user_id, g.club_id
  into v_head, v_club_id
  from public.coach_groups g
  where g.id = p_group_id;

  if v_head is null or v_club_id is null then
    raise exception 'Group not found';
  end if;

  if v_uid = v_head then
    v_can_delete := true;
  else
    select exists (
      select 1
      from public.coach_group_coaches c
      where c.group_id = p_group_id
        and c.coach_user_id = v_uid
        and coalesce(c.is_head, false) = true
    )
    into v_can_delete;
  end if;

  if not v_can_delete then
    raise exception 'Only head coach can delete this group';
  end if;

  -- Ensure archive group exists for this club (for past events history).
  select g.id
  into v_archive_group_id
  from public.coach_groups g
  where g.club_id = v_club_id
    and g.name = '__ARCHIVE_HISTORIQUE__'
  order by g.created_at asc
  limit 1;

  if v_archive_group_id is null then
    insert into public.coach_groups (club_id, name, is_active, head_coach_user_id)
    values (v_club_id, '__ARCHIVE_HISTORIQUE__', false, v_head)
    returning id into v_archive_group_id;
  end if;

  -- Keep coach visibility: carry current group coaches onto archive group.
  insert into public.coach_group_coaches (group_id, coach_user_id, is_head)
  select
    v_archive_group_id,
    c.coach_user_id,
    coalesce(c.is_head, false)
  from public.coach_group_coaches c
  where c.group_id = p_group_id
    and not exists (
      select 1
      from public.coach_group_coaches ac
      where ac.group_id = v_archive_group_id
        and ac.coach_user_id = c.coach_user_id
    );

  -- Future events are deleted (attendees/coaches/items cascade via FK where applicable).
  delete from public.club_events e
  where e.group_id = p_group_id
    and e.starts_at >= now();

  -- Keep history: move past events to archive group.
  update public.club_events e
  set group_id = v_archive_group_id
  where e.group_id = p_group_id
    and e.starts_at < now();

  -- Keep coach access on historical events: ensure event-coach links exist.
  insert into public.club_event_coaches (event_id, coach_id)
  select
    e.id as event_id,
    c.coach_user_id as coach_id
  from public.club_events e
  join public.coach_group_coaches c
    on c.group_id = v_archive_group_id
  where e.group_id = v_archive_group_id
    and e.starts_at < now()
    and not exists (
      select 1
      from public.club_event_coaches ec
      where ec.event_id = e.id
        and ec.coach_id = c.coach_user_id
    );

  -- Optional: move series rows to archive group too (if column exists).
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'club_event_series'
      and c.column_name = 'group_id'
  ) then
    execute 'update public.club_event_series set group_id = $1 where group_id = $2'
    using v_archive_group_id, p_group_id;
  end if;

  -- Delete group links and group row.
  delete from public.coach_group_categories where group_id = p_group_id;
  delete from public.coach_group_players where group_id = p_group_id;
  delete from public.coach_group_coaches where group_id = p_group_id;
  delete from public.coach_groups where id = p_group_id;
end;
$$;

grant execute on function public.coach_group_delete_keep_history(uuid) to authenticated;
