-- Keep only one thread_message notification row per thread.
-- On each new message: update existing notification + reset recipients to unread.

create or replace function public.create_notifications_for_thread_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread public.message_threads%rowtype;
  v_title text;
  v_notification_id uuid;
begin
  select * into v_thread from public.message_threads where id = new.thread_id;
  if v_thread.id is null then
    return new;
  end if;

  -- Gracefully no-op if notifications center is not available.
  begin
    -- Avoid duplicates under concurrent inserts: one notification row per thread.
    perform pg_advisory_xact_lock(hashtext(v_thread.id::text));

    v_title := case
      when v_thread.thread_type = 'organization' then 'Nouveau message (organisation)'
      when v_thread.thread_type = 'group' then 'Nouveau message (groupe)'
      when v_thread.thread_type = 'event' then 'Nouveau message (événement)'
      else 'Nouveau message'
    end;

    select n.id
    into v_notification_id
    from public.notifications n
    where n.kind = 'thread_message'
      and coalesce(n.data->>'thread_id', '') = v_thread.id::text
    order by n.created_at desc
    limit 1;

    if v_notification_id is null then
      insert into public.notifications (actor_user_id, type, kind, title, body, data)
      values (
        new.sender_user_id,
        'thread_message',
        'thread_message',
        v_title,
        left(coalesce(new.body, ''), 280),
        jsonb_build_object(
          'thread_id', v_thread.id,
          'organization_id', v_thread.organization_id,
          'thread_type', v_thread.thread_type
        )
      )
      returning id into v_notification_id;
    else
      update public.notifications n
      set
        actor_user_id = new.sender_user_id,
        type = 'thread_message',
        kind = 'thread_message',
        title = v_title,
        body = left(coalesce(new.body, ''), 280),
        data = jsonb_build_object(
          'thread_id', v_thread.id,
          'organization_id', v_thread.organization_id,
          'thread_type', v_thread.thread_type
        ),
        created_at = now()
      where n.id = v_notification_id;
    end if;

    if v_notification_id is not null then
      insert into public.notification_recipients (
        notification_id,
        user_id,
        is_read,
        read_at,
        is_deleted,
        deleted_at,
        created_at
      )
      select
        v_notification_id,
        tp.user_id,
        false,
        null,
        false,
        null,
        now()
      from public.thread_participants tp
      where tp.thread_id = v_thread.id
        and tp.user_id <> new.sender_user_id
      on conflict (notification_id, user_id)
      do update set
        is_read = false,
        read_at = null,
        is_deleted = false,
        deleted_at = null;

      -- Never notify sender about their own message.
      delete from public.notification_recipients nr
      where nr.notification_id = v_notification_id
        and nr.user_id = new.sender_user_id;
    end if;
  exception
    when undefined_table then
      null;
  end;

  return new;
end;
$$;

-- One-time cleanup: keep only latest thread_message notification per thread.
with ranked as (
  select
    n.id,
    coalesce(n.data->>'thread_id', '') as thread_id,
    row_number() over (
      partition by coalesce(n.data->>'thread_id', '')
      order by n.created_at desc, n.id desc
    ) as rn
  from public.notifications n
  where n.kind = 'thread_message'
    and coalesce(n.data->>'thread_id', '') <> ''
)
delete from public.notifications n
using ranked r
where n.id = r.id
  and r.rn > 1;
