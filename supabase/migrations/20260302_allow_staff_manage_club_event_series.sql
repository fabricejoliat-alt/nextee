-- Allow group staff (coach/head coach/manager) to manage recurring series.

alter table if exists public.club_event_series enable row level security;

drop policy if exists "group_staff_can_select_club_event_series" on public.club_event_series;
create policy "group_staff_can_select_club_event_series"
on public.club_event_series
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
    where g.id = club_event_series.group_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_insert_club_event_series" on public.club_event_series;
create policy "group_staff_can_insert_club_event_series"
on public.club_event_series
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
    where g.id = club_event_series.group_id
      and g.club_id = club_event_series.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_update_club_event_series" on public.club_event_series;
create policy "group_staff_can_update_club_event_series"
on public.club_event_series
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
    where g.id = club_event_series.group_id
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
    where g.id = club_event_series.group_id
      and g.club_id = club_event_series.club_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_delete_club_event_series" on public.club_event_series;
create policy "group_staff_can_delete_club_event_series"
on public.club_event_series
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
    where g.id = club_event_series.group_id
      and (
        cgc.coach_user_id is not null
        or g.head_coach_user_id = auth.uid()
        or cm.user_id is not null
      )
  )
);
