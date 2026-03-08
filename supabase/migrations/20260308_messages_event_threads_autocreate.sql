-- Auto-create and maintain event threads + participants.

create unique index if not exists idx_message_threads_unique_event
  on public.message_threads (event_id)
  where thread_type = 'event' and event_id is not null;

create or replace function public.pick_event_thread_actor_user_id(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select e.id, e.group_id, e.club_id
    from public.club_events e
    where e.id = p_event_id
  )
  select coalesce(
    -- Head coach
    (
      select g.head_coach_user_id
      from ev
      join public.coach_groups g on g.id = ev.group_id
      where g.head_coach_user_id is not null
      limit 1
    ),
    -- Assigned event coach
    (
      select ec.coach_id
      from public.club_event_coaches ec
      where ec.event_id = p_event_id
      limit 1
    ),
    -- Group coach
    (
      select cgc.coach_user_id
      from ev
      join public.coach_group_coaches cgc on cgc.group_id = ev.group_id
      limit 1
    ),
    -- Club manager
    (
      select cm.user_id
      from ev
      join public.club_members cm on cm.club_id = ev.club_id
      where cm.is_active = true
        and cm.role = 'manager'
      limit 1
    )
  );
$$;

create or replace function public.sync_event_thread_participants(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread_id uuid;
begin
  if p_event_id is null then
    return;
  end if;

  select t.id
  into v_thread_id
  from public.message_threads t
  where t.thread_type = 'event'
    and t.event_id = p_event_id
    and t.is_active = true
  limit 1;

  if v_thread_id is null then
    return;
  end if;

  -- Coaches/staff/managers in thread can always post.
  insert into public.thread_participants (thread_id, user_id, can_post)
  select distinct v_thread_id, x.user_id, true
  from (
    select g.head_coach_user_id as user_id
    from public.club_events e
    join public.coach_groups g on g.id = e.group_id
    where e.id = p_event_id
      and g.head_coach_user_id is not null

    union

    select ec.coach_id as user_id
    from public.club_event_coaches ec
    where ec.event_id = p_event_id

    union

    select cgc.coach_user_id as user_id
    from public.club_events e
    join public.coach_group_coaches cgc on cgc.group_id = e.group_id
    where e.id = p_event_id

    union

    select cm.user_id as user_id
    from public.club_events e
    join public.club_members cm on cm.club_id = e.club_id
    where e.id = p_event_id
      and cm.is_active = true
      and cm.role in ('manager')
  ) x
  where x.user_id is not null
  on conflict (thread_id, user_id)
  do update set can_post = excluded.can_post, updated_at = now();

  -- Player attendees can post.
  insert into public.thread_participants (thread_id, user_id, can_post)
  select distinct v_thread_id, a.player_id, true
  from public.club_event_attendees a
  where a.event_id = p_event_id
  on conflict (thread_id, user_id)
  do update set can_post = excluded.can_post, updated_at = now();

  -- Guardians can post if link allows viewing.
  insert into public.thread_participants (thread_id, user_id, can_post)
  select distinct v_thread_id, pg.guardian_user_id, true
  from public.club_event_attendees a
  join public.player_guardians pg
    on pg.player_id = a.player_id
   and coalesce(pg.can_view, true) = true
  where a.event_id = p_event_id
  on conflict (thread_id, user_id)
  do update set can_post = excluded.can_post, updated_at = now();
end;
$$;

create or replace function public.ensure_event_thread_for_event(p_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.club_events%rowtype;
  v_thread_id uuid;
  v_actor uuid;
  v_title text;
begin
  if p_event_id is null then
    return null;
  end if;

  select *
  into v_event
  from public.club_events e
  where e.id = p_event_id;

  if v_event.id is null then
    return null;
  end if;

  if v_event.club_id is null then
    return null;
  end if;

  select t.id
  into v_thread_id
  from public.message_threads t
  where t.thread_type = 'event'
    and t.event_id = v_event.id
  limit 1;

  if v_thread_id is null then
    v_actor := public.pick_event_thread_actor_user_id(v_event.id);
    if v_actor is null then
      return null;
    end if;

    v_title := coalesce(
      nullif(trim(coalesce(v_event.title, '')), ''),
      case
        when coalesce(v_event.event_type, '') = 'training' then 'Entraînement'
        when coalesce(v_event.event_type, '') = 'camp' then 'Stage'
        when coalesce(v_event.event_type, '') = 'interclub' then 'Interclubs'
        else 'Événement'
      end
    );

    insert into public.message_threads (
      organization_id,
      thread_type,
      title,
      event_id,
      created_by,
      is_locked,
      is_active
    )
    values (
      v_event.club_id,
      'event',
      v_title,
      v_event.id,
      v_actor,
      false,
      true
    )
    returning id into v_thread_id;
  else
    update public.message_threads t
    set
      organization_id = v_event.club_id,
      title = coalesce(
        nullif(trim(coalesce(v_event.title, '')), ''),
        t.title
      ),
      is_active = true
    where t.id = v_thread_id;
  end if;

  perform public.sync_event_thread_participants(v_event.id);
  return v_thread_id;
end;
$$;

grant execute on function public.pick_event_thread_actor_user_id(uuid) to authenticated;
grant execute on function public.sync_event_thread_participants(uuid) to authenticated;
grant execute on function public.ensure_event_thread_for_event(uuid) to authenticated;

create or replace function public.trg_ensure_event_thread_on_club_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_event_thread_for_event(new.id);
  return new;
end;
$$;

drop trigger if exists trg_ensure_event_thread_on_club_events on public.club_events;
create trigger trg_ensure_event_thread_on_club_events
after insert or update of title, event_type, group_id, club_id, status on public.club_events
for each row execute function public.trg_ensure_event_thread_on_club_events();

create or replace function public.trg_sync_event_thread_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := coalesce(new.event_id, old.event_id);
  perform public.sync_event_thread_participants(v_event_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_sync_event_thread_participants_attendees on public.club_event_attendees;
create trigger trg_sync_event_thread_participants_attendees
after insert or update or delete on public.club_event_attendees
for each row execute function public.trg_sync_event_thread_participants();

drop trigger if exists trg_sync_event_thread_participants_event_coaches on public.club_event_coaches;
create trigger trg_sync_event_thread_participants_event_coaches
after insert or update or delete on public.club_event_coaches
for each row execute function public.trg_sync_event_thread_participants();

-- Backfill existing event threads for historical data.
do $$
declare
  r record;
begin
  for r in
    select e.id
    from public.club_events e
  loop
    perform public.ensure_event_thread_for_event(r.id);
  end loop;
end $$;

