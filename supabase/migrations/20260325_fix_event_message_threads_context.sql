-- Fix legacy event threads that still carry a group_id/player_id context
-- and make the auto-sync function always normalize event-thread context.

update public.message_threads
set
  group_id = null,
  player_id = null
where thread_type = 'event'
  and (group_id is not null or player_id is not null);

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

  update public.message_threads
  set
    group_id = null,
    player_id = null
  where thread_type = 'event'
    and event_id = v_event.id;

  delete from public.message_threads t
  where t.thread_type = 'event'
    and t.event_id = v_event.id
    and (
      t.group_id is not null
      or t.player_id is not null
      or t.event_id is null
    );

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
      group_id,
      player_id,
      created_by,
      is_locked,
      is_active
    )
    values (
      v_event.club_id,
      'event',
      v_title,
      v_event.id,
      null,
      null,
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
      event_id = v_event.id,
      group_id = null,
      player_id = null,
      is_active = true
    where t.id = v_thread_id;
  end if;

  perform public.sync_event_thread_participants(v_event.id);
  return v_thread_id;
end;
$$;

drop trigger if exists trg_ensure_event_thread_on_club_events on public.club_events;
create trigger trg_ensure_event_thread_on_club_events
after insert or update of title, event_type, group_id, club_id, status on public.club_events
for each row execute function public.trg_ensure_event_thread_on_club_events();
