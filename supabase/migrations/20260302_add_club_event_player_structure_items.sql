-- Separate coach planned structure (individual per player) from player realized structure.

create table if not exists public.club_event_player_structure_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  minutes integer not null check (minutes > 0 and minutes <= 180),
  note text,
  position integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_cepsi_event_player_position
  on public.club_event_player_structure_items (event_id, player_id, position, created_at);

alter table if exists public.club_event_player_structure_items enable row level security;

drop policy if exists "participants_can_read_player_structure_items" on public.club_event_player_structure_items;
create policy "participants_can_read_player_structure_items"
on public.club_event_player_structure_items
for select
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = e.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    left join public.player_guardians pg
      on pg.player_id = club_event_player_structure_items.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
    where e.id = club_event_player_structure_items.event_id
      and (
        club_event_player_structure_items.player_id = auth.uid()
        or cgc.coach_user_id is not null
        or g.id is not null
        or cm.user_id is not null
        or pg.guardian_user_id is not null
      )
  )
);

drop policy if exists "group_staff_can_manage_player_structure_items" on public.club_event_player_structure_items;
create policy "group_staff_can_manage_player_structure_items"
on public.club_event_player_structure_items
for all
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    join public.club_event_attendees a
      on a.event_id = e.id
      and a.player_id = club_event_player_structure_items.player_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = e.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_player_structure_items.event_id
      and (
        cgc.coach_user_id is not null
        or g.id is not null
        or cm.user_id is not null
      )
  )
)
with check (
  exists (
    select 1
    from public.club_events e
    join public.club_event_attendees a
      on a.event_id = e.id
      and a.player_id = club_event_player_structure_items.player_id
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    left join public.club_members cm
      on cm.club_id = e.club_id
      and cm.user_id = auth.uid()
      and cm.is_active = true
      and cm.role = 'manager'
    where e.id = club_event_player_structure_items.event_id
      and (
        cgc.coach_user_id is not null
        or g.id is not null
        or cm.user_id is not null
      )
  )
);

