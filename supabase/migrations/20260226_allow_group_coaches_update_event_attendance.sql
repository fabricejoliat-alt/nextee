-- Allow coaches to update attendance status (present/absent) on event detail page.

alter table if exists public.club_event_attendees enable row level security;

drop policy if exists "group_coaches_can_update_event_attendees" on public.club_event_attendees;
create policy "group_coaches_can_update_event_attendees"
on public.club_event_attendees
for update
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.club_event_coaches ec
      on ec.event_id = e.id
      and ec.coach_id = auth.uid()
    where e.id = club_event_attendees.event_id
      and (
        g.id is not null
        or cgc.coach_user_id is not null
        or ec.coach_id is not null
      )
  )
)
with check (
  exists (
    select 1
    from public.club_events e
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.club_event_coaches ec
      on ec.event_id = e.id
      and ec.coach_id = auth.uid()
    where e.id = club_event_attendees.event_id
      and (
        g.id is not null
        or cgc.coach_user_id is not null
        or ec.coach_id is not null
      )
  )
);

