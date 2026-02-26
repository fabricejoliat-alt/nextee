-- Fix infinite recursion on club_event_attendees update policy.
-- Root cause: cross-policy checks can recurse through club_events/attendees.

alter table if exists public.club_event_attendees enable row level security;

create or replace function public.can_manage_event_attendance(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
    where e.id = target_event_id
      and (
        g.id is not null
        or cgc.coach_user_id is not null
        or ec.coach_id is not null
      )
  );
$$;

drop policy if exists "group_coaches_can_update_event_attendees" on public.club_event_attendees;
create policy "group_coaches_can_update_event_attendees"
on public.club_event_attendees
for update
to authenticated
using (public.can_manage_event_attendance(event_id))
with check (public.can_manage_event_attendance(event_id));

