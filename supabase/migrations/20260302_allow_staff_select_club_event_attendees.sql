-- Allow staff (head coach / group coach / manager) to read event attendees.

alter table if exists public.club_event_attendees enable row level security;

drop policy if exists "group_staff_can_select_club_event_attendees" on public.club_event_attendees;
create policy "group_staff_can_select_club_event_attendees"
on public.club_event_attendees
for select
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    where e.id = club_event_attendees.event_id
      and public.is_group_staff_member(e.group_id, auth.uid())
  )
);
