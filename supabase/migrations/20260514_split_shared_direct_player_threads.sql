-- Split corrupted direct player threads that contain multiple coaches.
-- Each direct player thread must belong to exactly one coach.

do $$
declare
  t record;
  coach_ids uuid[];
  coach_id uuid;
  new_thread_id uuid;
  participant_ids uuid[];
  guardian_ids uuid[];
begin
  for t in
    select mt.id, mt.organization_id, mt.player_id, mt.created_by, mt.title, mt.is_locked, mt.is_active, mt.created_at, mt.updated_at
    from public.message_threads mt
    where mt.thread_type = 'player'
      and coalesce(mt.player_thread_scope, 'direct') = 'direct'
      and mt.player_id is not null
      and mt.organization_id is not null
      and mt.created_by is not null
  loop
    select array_agg(distinct tp.user_id order by tp.user_id)
    into participant_ids
    from public.thread_participants tp
    where tp.thread_id = t.id;

    select array_agg(distinct cm.user_id order by cm.user_id)
    into coach_ids
    from public.thread_participants tp
    join public.club_members cm
      on cm.user_id = tp.user_id
     and cm.club_id = t.organization_id
     and cm.is_active = true
     and cm.role in ('manager', 'coach')
    where tp.thread_id = t.id
      and tp.user_id <> t.player_id;

    if coach_ids is null or array_length(coach_ids, 1) <= 1 then
      continue;
    end if;

    select array_agg(distinct tp.user_id order by tp.user_id)
    into guardian_ids
    from public.thread_participants tp
    where tp.thread_id = t.id
      and tp.user_id <> t.player_id
      and tp.user_id <> all(coach_ids);

    coach_id := coach_ids[1];
    update public.message_threads
      set created_by = coach_id
    where id = t.id;

    -- Create one thread per extra coach and move their relationship there.
    for coach_id in select unnest(coach_ids[2:array_length(coach_ids,1)]) loop
      insert into public.message_threads (
        organization_id,
        thread_type,
        title,
        group_id,
        event_id,
        player_id,
        created_by,
        player_thread_scope,
        is_locked,
        is_active,
        created_at,
        updated_at
      )
      values (
        t.organization_id,
        'player',
        t.title,
        null,
        null,
        t.player_id,
        coach_id,
        'direct',
        t.is_locked,
        t.is_active,
        now(),
        now()
      )
      returning id into new_thread_id;

      insert into public.thread_participants (thread_id, user_id, can_post, is_muted, last_read_at, created_at, updated_at)
      select new_thread_id, tp.user_id, tp.can_post, tp.is_muted, tp.last_read_at, now(), now()
      from public.thread_participants tp
      where tp.thread_id = t.id
        and (
          tp.user_id = t.player_id
          or tp.user_id = coach_id
          or (guardian_ids is not null and tp.user_id = any(guardian_ids))
        );
    end loop;

    -- Keep only player, first coach, and guardians on the original thread.
    delete from public.thread_participants tp
    where tp.thread_id = t.id
      and tp.user_id <> t.player_id
      and tp.user_id <> coach_ids[1]
      and not (guardian_ids is not null and tp.user_id = any(guardian_ids));

  end loop;
end $$;
