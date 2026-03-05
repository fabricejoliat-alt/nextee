-- Allow players/parents to read exceptional tournaments list in player flow.

alter table if exists public.om_exceptional_tournaments enable row level security;

drop policy if exists "org_members_can_select_om_exceptional_tournaments" on public.om_exceptional_tournaments;
create policy "org_members_can_select_om_exceptional_tournaments"
on public.om_exceptional_tournaments
for select
to authenticated
using (
  public.is_org_staff_member(om_exceptional_tournaments.organization_id, auth.uid())
  or exists (
    select 1
    from public.club_members cm
    where cm.club_id = om_exceptional_tournaments.organization_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role in ('player', 'parent', 'manager', 'coach')
  )
);
