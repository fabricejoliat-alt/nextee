-- In-app notification center (coach/player) + recipient states.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  kind text not null,
  title text not null,
  body text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- If table already existed, ensure expected columns exist as well.
alter table if exists public.notifications
  add column if not exists actor_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists type text,
  add column if not exists kind text,
  add column if not exists title text,
  add column if not exists body text,
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

do $$
declare
  _udt_name text;
begin
  select c.udt_name
  into _udt_name
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'notifications'
    and c.column_name = 'type';

  -- Always normalize non-type columns first.
  update public.notifications
  set
    title = coalesce(title, 'Notification'),
    data = coalesce(data, '{}'::jsonb),
    created_at = coalesce(created_at, now())
  where title is null or data is null or created_at is null;

  -- Legacy schema: convert enum type -> text to support new dynamic kinds.
  if _udt_name = 'notification_type' then
    alter table public.notifications
      alter column type type text
      using type::text;
  end if;

  -- Normalize type/kind as text values.
  update public.notifications
  set
    type = coalesce(type, kind, 'system'),
    kind = coalesce(kind, type, 'system')
  where type is null or kind is null;
end $$;

alter table if exists public.notifications
  alter column type set not null,
  alter column kind set not null,
  alter column title set not null;

create table if not exists public.notification_recipients (
  id bigserial primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(notification_id, user_id)
);

-- If tables already existed from previous iterations, ensure expected columns exist.
alter table if exists public.notification_recipients
  add column if not exists is_read boolean not null default false,
  add column if not exists read_at timestamptz,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz,
  add column if not exists created_at timestamptz not null default now();

update public.notification_recipients
set
  is_read = coalesce(is_read, false),
  is_deleted = coalesce(is_deleted, false),
  created_at = coalesce(created_at, now())
where is_read is null or is_deleted is null or created_at is null;

create index if not exists notifications_created_at_idx
  on public.notifications (created_at desc);

create index if not exists notification_recipients_user_state_idx
  on public.notification_recipients (user_id, is_deleted, is_read, created_at desc);

alter table if exists public.notifications enable row level security;
alter table if exists public.notification_recipients enable row level security;

-- Notifications: readable by actor or recipients

drop policy if exists "notifications_select_for_actor_or_recipient" on public.notifications;
create policy "notifications_select_for_actor_or_recipient"
on public.notifications
for select
to authenticated
using (
  actor_user_id = auth.uid()
  or exists (
    select 1
    from public.notification_recipients nr
    where nr.notification_id = notifications.id
      and nr.user_id = auth.uid()
      and nr.is_deleted = false
  )
);

-- Only authenticated actors can create notifications for their own actor id

drop policy if exists "notifications_insert_self_actor" on public.notifications;
create policy "notifications_insert_self_actor"
on public.notifications
for insert
to authenticated
with check (actor_user_id = auth.uid());

-- Recipients: user can read own recipient rows

drop policy if exists "notification_recipients_select_self" on public.notification_recipients;
create policy "notification_recipients_select_self"
on public.notification_recipients
for select
to authenticated
using (user_id = auth.uid());

-- Actor who created notification can add recipient rows for that notification

drop policy if exists "notification_recipients_insert_by_actor" on public.notification_recipients;
create policy "notification_recipients_insert_by_actor"
on public.notification_recipients
for insert
to authenticated
with check (
  exists (
    select 1
    from public.notifications n
    where n.id = notification_recipients.notification_id
      and n.actor_user_id = auth.uid()
  )
);

-- Recipient can update read/delete state of own rows only

drop policy if exists "notification_recipients_update_self" on public.notification_recipients;
create policy "notification_recipients_update_self"
on public.notification_recipients
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());
