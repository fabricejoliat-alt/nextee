-- Allow linked parents to access/manage child "player-space" data.
-- This complements existing self policies (user_id = auth.uid()).

-- TRAINING SESSIONS ----------------------------------------------------------
alter table if exists public.training_sessions enable row level security;

drop policy if exists "guardian_can_read_child_training_sessions" on public.training_sessions;
create policy "guardian_can_read_child_training_sessions"
on public.training_sessions
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = training_sessions.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_training_sessions" on public.training_sessions;
create policy "guardian_can_insert_child_training_sessions"
on public.training_sessions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = training_sessions.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_training_sessions" on public.training_sessions;
create policy "guardian_can_update_child_training_sessions"
on public.training_sessions
for update
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = training_sessions.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = training_sessions.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_training_sessions" on public.training_sessions;
create policy "guardian_can_delete_child_training_sessions"
on public.training_sessions
for delete
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = training_sessions.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

-- TRAINING SESSION ITEMS -----------------------------------------------------
alter table if exists public.training_session_items enable row level security;

drop policy if exists "guardian_can_read_child_training_session_items" on public.training_session_items;
create policy "guardian_can_read_child_training_session_items"
on public.training_session_items
for select
to authenticated
using (
  exists (
    select 1
    from public.training_sessions ts
    join public.player_guardians pg on pg.player_id = ts.user_id
    where ts.id = training_session_items.session_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_training_session_items" on public.training_session_items;
create policy "guardian_can_insert_child_training_session_items"
on public.training_session_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.training_sessions ts
    join public.player_guardians pg on pg.player_id = ts.user_id
    where ts.id = training_session_items.session_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_training_session_items" on public.training_session_items;
create policy "guardian_can_update_child_training_session_items"
on public.training_session_items
for update
to authenticated
using (
  exists (
    select 1
    from public.training_sessions ts
    join public.player_guardians pg on pg.player_id = ts.user_id
    where ts.id = training_session_items.session_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.training_sessions ts
    join public.player_guardians pg on pg.player_id = ts.user_id
    where ts.id = training_session_items.session_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_training_session_items" on public.training_session_items;
create policy "guardian_can_delete_child_training_session_items"
on public.training_session_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.training_sessions ts
    join public.player_guardians pg on pg.player_id = ts.user_id
    where ts.id = training_session_items.session_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

-- ROUNDS ---------------------------------------------------------------------
alter table if exists public.golf_rounds enable row level security;

drop policy if exists "guardian_can_read_child_rounds" on public.golf_rounds;
create policy "guardian_can_read_child_rounds"
on public.golf_rounds
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = golf_rounds.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_rounds" on public.golf_rounds;
create policy "guardian_can_insert_child_rounds"
on public.golf_rounds
for insert
to authenticated
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = golf_rounds.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_rounds" on public.golf_rounds;
create policy "guardian_can_update_child_rounds"
on public.golf_rounds
for update
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = golf_rounds.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = golf_rounds.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_rounds" on public.golf_rounds;
create policy "guardian_can_delete_child_rounds"
on public.golf_rounds
for delete
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = golf_rounds.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

alter table if exists public.golf_round_holes enable row level security;

drop policy if exists "guardian_can_read_child_round_holes" on public.golf_round_holes;
create policy "guardian_can_read_child_round_holes"
on public.golf_round_holes
for select
to authenticated
using (
  exists (
    select 1
    from public.golf_rounds gr
    join public.player_guardians pg on pg.player_id = gr.user_id
    where gr.id = golf_round_holes.round_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_round_holes" on public.golf_round_holes;
create policy "guardian_can_insert_child_round_holes"
on public.golf_round_holes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.golf_rounds gr
    join public.player_guardians pg on pg.player_id = gr.user_id
    where gr.id = golf_round_holes.round_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_round_holes" on public.golf_round_holes;
create policy "guardian_can_update_child_round_holes"
on public.golf_round_holes
for update
to authenticated
using (
  exists (
    select 1
    from public.golf_rounds gr
    join public.player_guardians pg on pg.player_id = gr.user_id
    where gr.id = golf_round_holes.round_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.golf_rounds gr
    join public.player_guardians pg on pg.player_id = gr.user_id
    where gr.id = golf_round_holes.round_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_round_holes" on public.golf_round_holes;
create policy "guardian_can_delete_child_round_holes"
on public.golf_round_holes
for delete
to authenticated
using (
  exists (
    select 1
    from public.golf_rounds gr
    join public.player_guardians pg on pg.player_id = gr.user_id
    where gr.id = golf_round_holes.round_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

-- ATTENDEES (planned trainings visibility + absent/present updates) ----------
alter table if exists public.club_event_attendees enable row level security;

drop policy if exists "guardian_can_read_child_event_attendance" on public.club_event_attendees;
create policy "guardian_can_read_child_event_attendance"
on public.club_event_attendees
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = club_event_attendees.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_update_child_event_attendance" on public.club_event_attendees;
create policy "guardian_can_update_child_event_attendance"
on public.club_event_attendees
for update
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = club_event_attendees.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = club_event_attendees.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

-- CLUB EVENTS (needed to render planned events linked to child attendance) ----
alter table if exists public.club_events enable row level security;

create or replace function public.parent_can_view_child_event(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.club_event_attendees a
    join public.player_guardians pg
      on pg.player_id = a.player_id
    where a.event_id = target_event_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  );
$$;

drop policy if exists "guardian_can_read_child_events" on public.club_events;
create policy "guardian_can_read_child_events"
on public.club_events
for select
to authenticated
using (public.parent_can_view_child_event(id));

-- CLUB EVENT STRUCTURE ITEMS -------------------------------------------------
alter table if exists public.club_event_structure_items enable row level security;

drop policy if exists "guardian_can_read_child_event_structure_items" on public.club_event_structure_items;
create policy "guardian_can_read_child_event_structure_items"
on public.club_event_structure_items
for select
to authenticated
using (public.parent_can_view_child_event(event_id));

-- COACH FEEDBACK VISIBLE TO CHILD -------------------------------------------
alter table if exists public.club_event_coach_feedback enable row level security;

drop policy if exists "guardian_can_read_child_coach_feedback" on public.club_event_coach_feedback;
create policy "guardian_can_read_child_coach_feedback"
on public.club_event_coach_feedback
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = club_event_coach_feedback.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

-- PLAYER ACTIVITY EVENTS (competition/camp) ---------------------------------
alter table if exists public.player_activity_events enable row level security;

drop policy if exists "guardian_can_read_child_player_activity_events" on public.player_activity_events;
create policy "guardian_can_read_child_player_activity_events"
on public.player_activity_events
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = player_activity_events.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_player_activity_events" on public.player_activity_events;
create policy "guardian_can_insert_child_player_activity_events"
on public.player_activity_events
for insert
to authenticated
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = player_activity_events.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_player_activity_events" on public.player_activity_events;
create policy "guardian_can_update_child_player_activity_events"
on public.player_activity_events
for update
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = player_activity_events.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = player_activity_events.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_player_activity_events" on public.player_activity_events;
create policy "guardian_can_delete_child_player_activity_events"
on public.player_activity_events
for delete
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = player_activity_events.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

-- MARKETPLACE ----------------------------------------------------------------
alter table if exists public.marketplace_items enable row level security;

drop policy if exists "guardian_can_read_child_marketplace_items" on public.marketplace_items;
create policy "guardian_can_read_child_marketplace_items"
on public.marketplace_items
for select
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = marketplace_items.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_marketplace_items" on public.marketplace_items;
create policy "guardian_can_insert_child_marketplace_items"
on public.marketplace_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = marketplace_items.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_marketplace_items" on public.marketplace_items;
create policy "guardian_can_update_child_marketplace_items"
on public.marketplace_items
for update
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = marketplace_items.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = marketplace_items.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_marketplace_items" on public.marketplace_items;
create policy "guardian_can_delete_child_marketplace_items"
on public.marketplace_items
for delete
to authenticated
using (
  exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = marketplace_items.user_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

alter table if exists public.marketplace_images enable row level security;

drop policy if exists "guardian_can_read_child_marketplace_images" on public.marketplace_images;
create policy "guardian_can_read_child_marketplace_images"
on public.marketplace_images
for select
to authenticated
using (
  exists (
    select 1
    from public.marketplace_items mi
    join public.player_guardians pg on pg.player_id = mi.user_id
    where mi.id = marketplace_images.item_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "guardian_can_insert_child_marketplace_images" on public.marketplace_images;
create policy "guardian_can_insert_child_marketplace_images"
on public.marketplace_images
for insert
to authenticated
with check (
  exists (
    select 1
    from public.marketplace_items mi
    join public.player_guardians pg on pg.player_id = mi.user_id
    where mi.id = marketplace_images.item_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_update_child_marketplace_images" on public.marketplace_images;
create policy "guardian_can_update_child_marketplace_images"
on public.marketplace_images
for update
to authenticated
using (
  exists (
    select 1
    from public.marketplace_items mi
    join public.player_guardians pg on pg.player_id = mi.user_id
    where mi.id = marketplace_images.item_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
)
with check (
  exists (
    select 1
    from public.marketplace_items mi
    join public.player_guardians pg on pg.player_id = mi.user_id
    where mi.id = marketplace_images.item_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);

drop policy if exists "guardian_can_delete_child_marketplace_images" on public.marketplace_images;
create policy "guardian_can_delete_child_marketplace_images"
on public.marketplace_images
for delete
to authenticated
using (
  exists (
    select 1
    from public.marketplace_items mi
    join public.player_guardians pg on pg.player_id = mi.user_id
    where mi.id = marketplace_images.item_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_edit, false) = true
  )
);
