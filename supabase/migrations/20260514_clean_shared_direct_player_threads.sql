-- Clean historical direct player threads so each coach has its own thread.
-- Also enforce the uniqueness expected by the API for direct player threads.

do $$
declare
  t record;
  coach_ids uuid[];
  extra_coach_id uuid;
  new_thread_id uuid;
  guardian_ids uuid[];
begin
  for t in
    select mt.id, mt.organization_id, mt.player_id, mt.created_by, mt.title, mt.is_locked, mt.is_active
    from public.message_threads mt
    where mt.thread_type = 'player'
      and coalesce(mt.player_thread_scope, 'direct') = 'direct'
      and mt.organization_id is not null
      and mt.player_id is not null
      and mt.created_by is not null
  loop
    select array_agg(distinct cm.user_id order by cm.user_id)
    into coach_ids
    from public.thread_participants tp
    join public.club_members cm
      on cm.user_id = tp.user_id
     and cm.club_id = t.organization_id
     and cm.is_active = true
     and cm.role in ('coach', 'manager')
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

    -- Keep the first coach on the original thread.
    update public.message_threads
      set created_by = coach_ids[1]
    where id = t.id;

    -- Create one thread for every extra coach and move the relevant participants there.
    foreach extra_coach_id in array coach_ids[2:array_length(coach_ids, 1)] loop
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
        coalesce(t.title, 'Discussion'),
        null,
        null,
        t.player_id,
        extra_coach_id,
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
          or tp.user_id = extra_coach_id
          or (guardian_ids is not null and tp.user_id = any(guardian_ids))
        );
    end loop;

    delete from public.thread_participants tp
    where tp.thread_id = t.id
      and tp.user_id <> t.player_id
      and tp.user_id <> coach_ids[1]
      and not (guardian_ids is not null and tp.user_id = any(guardian_ids));
  end loop;
end $$;

-- Remove duplicate direct threads for the same player/coach pair, keeping the most recent one.
with ranked as (
  select
    t.id,
    row_number() over (
      partition by t.organization_id, t.player_id, t.created_by
      order by t.updated_at desc, t.created_at desc, t.id desc
    ) as rn
  from public.message_threads t
  where t.thread_type = 'player'
    and coalesce(t.player_thread_scope, 'direct') = 'direct'
    and t.organization_id is not null
    and t.player_id is not null
    and t.created_by is not null
)
delete from public.message_threads t
using ranked r
where t.id = r.id
  and r.rn > 1;

drop index if exists public.idx_message_threads_unique_player_direct_per_staff;
drop index if exists public.idx_message_threads_unique_player_per_staff;

create unique index if not exists idx_message_threads_unique_player_direct_per_staff
  on public.message_threads (organization_id, player_id, created_by)
  where thread_type = 'player'
    and player_id is not null
    and created_by is not null
    and player_thread_scope = 'direct';

create unique index if not exists idx_message_threads_unique_player_per_staff
  on public.message_threads (organization_id, player_id, created_by)
  where thread_type = 'player'
    and player_id is not null
    and created_by is not null;
