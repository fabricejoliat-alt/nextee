-- Allow players/guardians to read internal contests linked to their results.

alter table if exists public.om_internal_contests enable row level security;

drop policy if exists "org_staff_can_select_om_internal_contests" on public.om_internal_contests;
create policy "org_staff_or_players_can_select_om_internal_contests"
on public.om_internal_contests
for select
to authenticated
using (
  public.is_org_staff_member(om_internal_contests.organization_id, auth.uid())
  or exists (
    select 1
    from public.om_internal_contest_results r
    where r.contest_id = om_internal_contests.id
      and r.player_id = auth.uid()
  )
  or exists (
    select 1
    from public.om_internal_contest_results r
    join public.player_guardians pg
      on pg.player_id = r.player_id
     and pg.guardian_user_id = auth.uid()
     and coalesce(pg.can_view, true) = true
    where r.contest_id = om_internal_contests.id
  )
);

