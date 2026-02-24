-- Allow coaches/managers to read all trainings of a player
-- if they share at least one active club membership.
-- This enables coach analytics to match player analytics in "Tous les entraînements".

alter table if exists public.training_sessions enable row level security;
alter table if exists public.training_session_items enable row level security;

drop policy if exists "coach_manager_can_read_shared_player_sessions" on public.training_sessions;
create policy "coach_manager_can_read_shared_player_sessions"
on public.training_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.club_members cm_staff
    join public.club_members cm_player
      on cm_player.club_id = cm_staff.club_id
    where cm_staff.user_id = auth.uid()
      and cm_staff.is_active = true
      and cm_staff.role in ('coach', 'manager')
      and cm_player.user_id = public.training_sessions.user_id
      and cm_player.is_active = true
  )
);

drop policy if exists "coach_manager_can_read_shared_player_session_items" on public.training_session_items;
create policy "coach_manager_can_read_shared_player_session_items"
on public.training_session_items
for select
to authenticated
using (
  exists (
    select 1
    from public.training_sessions ts
    join public.club_members cm_staff
      on cm_staff.user_id = auth.uid()
    join public.club_members cm_player
      on cm_player.club_id = cm_staff.club_id
    where ts.id = public.training_session_items.session_id
      and cm_staff.is_active = true
      and cm_staff.role in ('coach', 'manager')
      and cm_player.user_id = ts.user_id
      and cm_player.is_active = true
  )
);
