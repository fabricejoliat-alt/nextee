-- Player planned activity events (ex: competition on multiple days).

create table if not exists public.player_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('competition')),
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_text text,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists player_activity_events_user_idx
  on public.player_activity_events (user_id, starts_at desc);

alter table if exists public.player_activity_events enable row level security;

drop policy if exists "player_activity_events_select_own" on public.player_activity_events;
create policy "player_activity_events_select_own"
on public.player_activity_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "player_activity_events_insert_own" on public.player_activity_events;
create policy "player_activity_events_insert_own"
on public.player_activity_events
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "player_activity_events_update_own" on public.player_activity_events;
create policy "player_activity_events_update_own"
on public.player_activity_events
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "player_activity_events_delete_own" on public.player_activity_events;
create policy "player_activity_events_delete_own"
on public.player_activity_events
for delete
to authenticated
using (user_id = auth.uid());

