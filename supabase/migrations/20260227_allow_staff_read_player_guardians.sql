-- Allow coach/manager to read parent-child links for players in shared active clubs.
-- Needed so notification fan-out can include linked parents.

alter table if exists public.player_guardians enable row level security;

drop policy if exists "staff_can_read_shared_club_guardian_links" on public.player_guardians;
create policy "staff_can_read_shared_club_guardian_links"
on public.player_guardians
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
      and cm_player.user_id = player_guardians.player_id
      and cm_player.is_active = true
  )
);
