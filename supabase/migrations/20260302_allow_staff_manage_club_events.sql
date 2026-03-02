-- Allow group staff (coach/head coach/manager) to manage club events and links.

alter table if exists public.club_events enable row level security;
alter table if exists public.club_event_coaches enable row level security;
alter table if exists public.club_event_attendees enable row level security;
alter table if exists public.coach_group_players enable row level security;
alter table if exists public.coach_group_coaches enable row level security;

-- GROUP MEMBERSHIPS (read access for staff) ----------------------------------
drop policy if exists "group_staff_can_select_coach_group_players" on public.coach_group_players;
create policy "group_staff_can_select_coach_group_players"
on public.coach_group_players
for select
to authenticated
using (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = coach_group_players.group_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_select_coach_group_coaches" on public.coach_group_coaches;
create policy "group_staff_can_select_coach_group_coaches"
on public.coach_group_coaches
for select
to authenticated
using (
  exists (
    select 1
    from public.coach_groups g
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = coach_group_coaches.group_id
      and (
        g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

-- CLUB EVENTS ----------------------------------------------------------------
drop policy if exists "group_staff_can_select_club_events" on public.club_events;
create policy "group_staff_can_select_club_events"
on public.club_events
for select
to authenticated
using (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = club_events.group_id
      and g.club_id = club_events.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_insert_club_events" on public.club_events;
create policy "group_staff_can_insert_club_events"
on public.club_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = club_events.group_id
      and g.club_id = club_events.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_update_club_events" on public.club_events;
create policy "group_staff_can_update_club_events"
on public.club_events
for update
to authenticated
using (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = club_events.group_id
      and g.club_id = club_events.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
)
with check (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = club_events.group_id
      and g.club_id = club_events.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_delete_club_events" on public.club_events;
create policy "group_staff_can_delete_club_events"
on public.club_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where g.id = club_events.group_id
      and g.club_id = club_events.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

-- CLUB EVENT COACHES ---------------------------------------------------------
drop policy if exists "group_staff_can_select_club_event_coaches" on public.club_event_coaches;
create policy "group_staff_can_select_club_event_coaches"
on public.club_event_coaches
for select
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    join public.coach_groups g on g.id = e.group_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_coaches.event_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_insert_club_event_coaches" on public.club_event_coaches;
create policy "group_staff_can_insert_club_event_coaches"
on public.club_event_coaches
for insert
to authenticated
with check (
  exists (
    select 1
    from public.club_events e
    join public.coach_groups g on g.id = e.group_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_coaches.event_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
  and exists (
    select 1
    from public.club_events e
    join public.coach_group_coaches cgc on cgc.group_id = e.group_id
    where e.id = club_event_coaches.event_id
      and cgc.coach_user_id = club_event_coaches.coach_id
  )
);

drop policy if exists "group_staff_can_delete_club_event_coaches" on public.club_event_coaches;
create policy "group_staff_can_delete_club_event_coaches"
on public.club_event_coaches
for delete
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    join public.coach_groups g on g.id = e.group_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_coaches.event_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

-- CLUB EVENT ATTENDEES -------------------------------------------------------
drop policy if exists "group_staff_can_insert_club_event_attendees" on public.club_event_attendees;
create policy "group_staff_can_insert_club_event_attendees"
on public.club_event_attendees
for insert
to authenticated
with check (
  exists (
    select 1
    from public.club_events e
    join public.coach_groups g on g.id = e.group_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = g.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_attendees.event_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
  and exists (
    select 1
    from public.club_events e
    left join public.coach_group_players gp
      on gp.group_id = e.group_id
      and gp.player_user_id = club_event_attendees.player_id
    left join public.club_members cm_target
      on cm_target.club_id = e.club_id
      and cm_target.user_id = club_event_attendees.player_id
      and cm_target.is_active = true
    where e.id = club_event_attendees.event_id
      and (
        gp.player_user_id is not null
        or cm_target.user_id is not null
      )
  )
);
