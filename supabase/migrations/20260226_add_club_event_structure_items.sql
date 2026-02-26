-- Coach-defined training structure ("postes") attached to planned events.

create table if not exists public.club_event_structure_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.club_events(id) on delete cascade,
  category text not null,
  minutes integer not null check (minutes > 0 and minutes <= 180),
  note text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists club_event_structure_items_event_idx
  on public.club_event_structure_items (event_id, position, created_at);

alter table if exists public.club_event_structure_items enable row level security;

drop policy if exists "event_participants_can_read_structure_items" on public.club_event_structure_items;
create policy "event_participants_can_read_structure_items"
on public.club_event_structure_items
for select
to authenticated
using (
  exists (
    select 1
    from public.club_events e
    left join public.club_event_attendees a
      on a.event_id = e.id
      and a.player_id = auth.uid()
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    where e.id = club_event_structure_items.event_id
      and (
        a.player_id is not null
        or cgc.coach_user_id is not null
        or g.id is not null
      )
  )
);

drop policy if exists "group_coaches_can_manage_structure_items" on public.club_event_structure_items;
create policy "group_coaches_can_manage_structure_items"
on public.club_event_structure_items
for all
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
    where e.id = club_event_structure_items.event_id
      and (
        cgc.coach_user_id is not null
        or g.id is not null
      )
  )
)
with check (
  exists (
    select 1
    from public.club_events e
    left join public.coach_group_coaches cgc
      on cgc.group_id = e.group_id
      and cgc.coach_user_id = auth.uid()
    left join public.coach_groups g
      on g.id = e.group_id
      and g.head_coach_user_id = auth.uid()
    where e.id = club_event_structure_items.event_id
      and (
        cgc.coach_user_id is not null
        or g.id is not null
      )
  )
);
