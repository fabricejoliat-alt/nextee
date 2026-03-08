-- Structured messaging module (organization/group/event/player threads)
-- Phase 1: threads + participants + messages + read state + RLS.

create table if not exists public.message_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.clubs(id) on delete cascade,
  thread_type text not null check (thread_type in ('organization', 'group', 'event', 'player')),
  title text not null,
  group_id uuid null references public.coach_groups(id) on delete set null,
  event_id uuid null references public.club_events(id) on delete set null,
  player_id uuid null references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete set null,
  is_locked boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_threads_context_check check (
    (thread_type = 'organization' and group_id is null and event_id is null and player_id is null)
    or (thread_type = 'group' and group_id is not null and event_id is null and player_id is null)
    or (thread_type = 'event' and event_id is not null and group_id is null and player_id is null)
    or (thread_type = 'player' and player_id is not null and event_id is null)
  )
);

create index if not exists idx_message_threads_org_type_updated
  on public.message_threads (organization_id, thread_type, updated_at desc);

create index if not exists idx_message_threads_group
  on public.message_threads (group_id, updated_at desc)
  where group_id is not null;

create index if not exists idx_message_threads_event
  on public.message_threads (event_id, updated_at desc)
  where event_id is not null;

create index if not exists idx_message_threads_player
  on public.message_threads (player_id, updated_at desc)
  where player_id is not null;

create table if not exists public.thread_participants (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  can_post boolean not null default true,
  is_muted boolean not null default false,
  last_read_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_thread_participants_user
  on public.thread_participants (user_id, updated_at desc);

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete set null,
  message_type text not null default 'text' check (message_type in ('text', 'poll')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_thread_messages_thread_created
  on public.thread_messages (thread_id, created_at desc);

create or replace function public.set_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_message_threads_updated_at on public.message_threads;
create trigger trg_message_threads_updated_at
before update on public.message_threads
for each row execute function public.set_timestamp_updated_at();

drop trigger if exists trg_thread_participants_updated_at on public.thread_participants;
create trigger trg_thread_participants_updated_at
before update on public.thread_participants
for each row execute function public.set_timestamp_updated_at();

create or replace function public.bump_message_thread_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.message_threads t
  set updated_at = now()
  where t.id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_bump_message_thread_updated_at on public.thread_messages;
create trigger trg_bump_message_thread_updated_at
after insert on public.thread_messages
for each row execute function public.bump_message_thread_updated_at();

create or replace function public.is_org_member_active(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_members cm
    where cm.club_id = p_org_id
      and cm.user_id = p_user_id
      and cm.is_active = true
  );
$$;

create or replace function public.can_manage_message_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads t
    where t.id = p_thread_id
      and (
        t.created_by = p_user_id
        or public.is_org_staff_member(t.organization_id, p_user_id)
        or public.is_org_manager_member(t.organization_id, p_user_id)
      )
  );
$$;

create or replace function public.can_read_message_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads t
    where t.id = p_thread_id
      and (
        public.can_manage_message_thread(t.id, p_user_id)
        or exists (
          select 1
          from public.thread_participants tp
          where tp.thread_id = t.id
            and tp.user_id = p_user_id
        )
        or (
          t.thread_type = 'organization'
          and public.is_org_member_active(t.organization_id, p_user_id)
        )
      )
  );
$$;

create or replace function public.can_post_message_thread(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.message_threads t
    where t.id = p_thread_id
      and t.is_active = true
      and (
        public.can_manage_message_thread(t.id, p_user_id)
        or (
          t.is_locked = false
          and exists (
            select 1
            from public.thread_participants tp
            where tp.thread_id = t.id
              and tp.user_id = p_user_id
              and tp.can_post = true
          )
        )
      )
  );
$$;

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

grant execute on function public.is_org_member_active(uuid, uuid) to authenticated;
grant execute on function public.can_manage_message_thread(uuid, uuid) to authenticated;
grant execute on function public.can_read_message_thread(uuid, uuid) to authenticated;
grant execute on function public.can_post_message_thread(uuid, uuid) to authenticated;
grant execute on function public.can_create_message_thread(uuid, text, uuid, uuid, uuid, uuid) to authenticated;

alter table if exists public.message_threads enable row level security;
alter table if exists public.thread_participants enable row level security;
alter table if exists public.thread_messages enable row level security;

drop policy if exists "message_threads_select" on public.message_threads;
create policy "message_threads_select"
on public.message_threads
for select
to authenticated
using (public.can_read_message_thread(message_threads.id, auth.uid()));

drop policy if exists "message_threads_insert" on public.message_threads;
create policy "message_threads_insert"
on public.message_threads
for insert
to authenticated
with check (
  created_by = auth.uid()
  and public.can_create_message_thread(
    message_threads.organization_id,
    message_threads.thread_type,
    message_threads.group_id,
    message_threads.event_id,
    message_threads.player_id,
    auth.uid()
  )
);

drop policy if exists "message_threads_update" on public.message_threads;
create policy "message_threads_update"
on public.message_threads
for update
to authenticated
using (public.can_manage_message_thread(message_threads.id, auth.uid()))
with check (public.can_manage_message_thread(message_threads.id, auth.uid()));

drop policy if exists "message_threads_delete" on public.message_threads;
create policy "message_threads_delete"
on public.message_threads
for delete
to authenticated
using (public.can_manage_message_thread(message_threads.id, auth.uid()));

drop policy if exists "thread_participants_select" on public.thread_participants;
create policy "thread_participants_select"
on public.thread_participants
for select
to authenticated
using (
  user_id = auth.uid()
  or public.can_manage_message_thread(thread_participants.thread_id, auth.uid())
);

drop policy if exists "thread_participants_insert" on public.thread_participants;
create policy "thread_participants_insert"
on public.thread_participants
for insert
to authenticated
with check (public.can_manage_message_thread(thread_participants.thread_id, auth.uid()));

drop policy if exists "thread_participants_update" on public.thread_participants;
create policy "thread_participants_update"
on public.thread_participants
for update
to authenticated
using (
  user_id = auth.uid()
  or public.can_manage_message_thread(thread_participants.thread_id, auth.uid())
)
with check (
  user_id = auth.uid()
  or public.can_manage_message_thread(thread_participants.thread_id, auth.uid())
);

drop policy if exists "thread_participants_delete" on public.thread_participants;
create policy "thread_participants_delete"
on public.thread_participants
for delete
to authenticated
using (public.can_manage_message_thread(thread_participants.thread_id, auth.uid()));

drop policy if exists "thread_messages_select" on public.thread_messages;
create policy "thread_messages_select"
on public.thread_messages
for select
to authenticated
using (public.can_read_message_thread(thread_messages.thread_id, auth.uid()));

drop policy if exists "thread_messages_insert" on public.thread_messages;
create policy "thread_messages_insert"
on public.thread_messages
for insert
to authenticated
with check (
  sender_user_id = auth.uid()
  and public.can_post_message_thread(thread_messages.thread_id, auth.uid())
);

drop policy if exists "thread_messages_update_own_recent" on public.thread_messages;
create policy "thread_messages_update_own_recent"
on public.thread_messages
for update
to authenticated
using (
  sender_user_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
)
with check (
  sender_user_id = auth.uid()
  and created_at >= now() - interval '15 minutes'
);

drop policy if exists "thread_messages_delete_own_recent_or_staff" on public.thread_messages;
create policy "thread_messages_delete_own_recent_or_staff"
on public.thread_messages
for delete
to authenticated
using (
  (
    sender_user_id = auth.uid()
    and created_at >= now() - interval '15 minutes'
  )
  or public.can_manage_message_thread(thread_messages.thread_id, auth.uid())
);

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

drop trigger if exists trg_thread_message_notifications on public.thread_messages;
create trigger trg_thread_message_notifications
after insert on public.thread_messages
for each row execute function public.create_notifications_for_thread_message();
