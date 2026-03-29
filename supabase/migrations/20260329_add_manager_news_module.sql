create table if not exists public.club_news (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  title text not null,
  summary text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'archived')),
  scheduled_for timestamptz,
  published_at timestamptz,
  send_notification boolean not null default true,
  send_email boolean not null default false,
  include_linked_parents boolean not null default false,
  last_notification_sent_at timestamptz,
  last_email_sent_at timestamptz,
  last_dispatch_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint club_news_schedule_check check (
    (status <> 'scheduled')
    or scheduled_for is not null
  )
);

create index if not exists club_news_club_idx
  on public.club_news (club_id, status, coalesce(published_at, scheduled_for, created_at) desc);

create index if not exists club_news_created_by_idx
  on public.club_news (created_by, created_at desc);

create table if not exists public.club_news_targets (
  id uuid primary key default gen_random_uuid(),
  news_id uuid not null references public.club_news(id) on delete cascade,
  target_type text not null check (target_type in ('role', 'user', 'group', 'group_category', 'age_band')),
  target_value text not null,
  created_at timestamptz not null default now(),
  unique (news_id, target_type, target_value)
);

create index if not exists club_news_targets_news_idx
  on public.club_news_targets (news_id);

create index if not exists club_news_targets_lookup_idx
  on public.club_news_targets (target_type, target_value);

create or replace function public.touch_club_news_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_club_news_updated_at on public.club_news;
create trigger trg_touch_club_news_updated_at
before update on public.club_news
for each row
execute function public.touch_club_news_updated_at();

alter table if exists public.club_news enable row level security;
alter table if exists public.club_news_targets enable row level security;

drop policy if exists "club_news_select_for_active_members" on public.club_news;
create policy "club_news_select_for_active_members"
on public.club_news
for select
to authenticated
using (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_news.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
  )
);

drop policy if exists "club_news_insert_for_managers" on public.club_news;
create policy "club_news_insert_for_managers"
on public.club_news
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_news.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "club_news_update_for_managers" on public.club_news;
create policy "club_news_update_for_managers"
on public.club_news
for update
to authenticated
using (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_news.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
)
with check (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_news.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "club_news_delete_for_managers" on public.club_news;
create policy "club_news_delete_for_managers"
on public.club_news
for delete
to authenticated
using (
  exists (
    select 1
    from public.club_members cm
    where cm.club_id = club_news.club_id
      and cm.user_id = auth.uid()
      and cm.role = 'manager'
      and cm.is_active = true
  )
);

drop policy if exists "club_news_targets_select_for_active_members" on public.club_news_targets;
create policy "club_news_targets_select_for_active_members"
on public.club_news_targets
for select
to authenticated
using (
  exists (
    select 1
    from public.club_news cn
    join public.club_members cm
      on cm.club_id = cn.club_id
     and cm.user_id = auth.uid()
     and cm.is_active = true
    where cn.id = club_news_targets.news_id
  )
);

drop policy if exists "club_news_targets_insert_for_managers" on public.club_news_targets;
create policy "club_news_targets_insert_for_managers"
on public.club_news_targets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.club_news cn
    join public.club_members cm
      on cm.club_id = cn.club_id
     and cm.user_id = auth.uid()
     and cm.role = 'manager'
     and cm.is_active = true
    where cn.id = club_news_targets.news_id
  )
);

drop policy if exists "club_news_targets_update_for_managers" on public.club_news_targets;
create policy "club_news_targets_update_for_managers"
on public.club_news_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.club_news cn
    join public.club_members cm
      on cm.club_id = cn.club_id
     and cm.user_id = auth.uid()
     and cm.role = 'manager'
     and cm.is_active = true
    where cn.id = club_news_targets.news_id
  )
)
with check (
  exists (
    select 1
    from public.club_news cn
    join public.club_members cm
      on cm.club_id = cn.club_id
     and cm.user_id = auth.uid()
     and cm.role = 'manager'
     and cm.is_active = true
    where cn.id = club_news_targets.news_id
  )
);

drop policy if exists "club_news_targets_delete_for_managers" on public.club_news_targets;
create policy "club_news_targets_delete_for_managers"
on public.club_news_targets
for delete
to authenticated
using (
  exists (
    select 1
    from public.club_news cn
    join public.club_members cm
      on cm.club_id = cn.club_id
     and cm.user_id = auth.uid()
     and cm.role = 'manager'
     and cm.is_active = true
    where cn.id = club_news_targets.news_id
  )
);
