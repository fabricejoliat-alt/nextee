-- Allow coaches/managers to read player rounds and round holes
-- when both are active members of the same club.

alter table if exists public.golf_rounds enable row level security;
alter table if exists public.golf_round_holes enable row level security;

drop policy if exists "coach_manager_can_read_shared_club_rounds" on public.golf_rounds;
create policy "coach_manager_can_read_shared_club_rounds"
on public.golf_rounds
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
      and cm_player.user_id = public.golf_rounds.user_id
      and cm_player.is_active = true
  )
);

drop policy if exists "coach_manager_can_read_shared_club_round_holes" on public.golf_round_holes;
create policy "coach_manager_can_read_shared_club_round_holes"
on public.golf_round_holes
for select
to authenticated
using (
  exists (
    select 1
    from public.golf_rounds gr
    join public.club_members cm_staff
      on cm_staff.user_id = auth.uid()
    join public.club_members cm_player
      on cm_player.club_id = cm_staff.club_id
    where gr.id = public.golf_round_holes.round_id
      and cm_staff.is_active = true
      and cm_staff.role in ('coach', 'manager')
      and cm_player.user_id = gr.user_id
      and cm_player.is_active = true
  )
);
