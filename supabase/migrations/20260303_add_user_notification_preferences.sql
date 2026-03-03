-- Per-user notification preferences for in-app and push notifications.

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  receive_in_app boolean not null default true,
  receive_push boolean not null default false,
  enabled_kinds text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table if exists public.user_notification_preferences enable row level security;

drop policy if exists "users_can_select_own_notification_preferences" on public.user_notification_preferences;
create policy "users_can_select_own_notification_preferences"
on public.user_notification_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users_can_insert_own_notification_preferences" on public.user_notification_preferences;
create policy "users_can_insert_own_notification_preferences"
on public.user_notification_preferences
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "users_can_update_own_notification_preferences" on public.user_notification_preferences;
create policy "users_can_update_own_notification_preferences"
on public.user_notification_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.touch_user_notification_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_notification_preferences_updated_at on public.user_notification_preferences;
create trigger trg_user_notification_preferences_updated_at
before update on public.user_notification_preferences
for each row
execute function public.touch_user_notification_preferences_updated_at();
