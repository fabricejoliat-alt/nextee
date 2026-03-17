-- Align DB constraints with the UI: allow up to 300 minutes.

alter table if exists public.club_events
  drop constraint if exists club_events_duration_minutes_check;

alter table if exists public.club_events
  add constraint club_events_duration_minutes_check
  check (
    duration_minutes is null
    or (duration_minutes > 0 and duration_minutes <= 300)
  );

alter table if exists public.club_event_structure_items
  drop constraint if exists club_event_structure_items_minutes_check;

alter table if exists public.club_event_structure_items
  add constraint club_event_structure_items_minutes_check
  check (minutes > 0 and minutes <= 300);

alter table if exists public.club_event_player_structure_items
  drop constraint if exists club_event_player_structure_items_minutes_check;

alter table if exists public.club_event_player_structure_items
  add constraint club_event_player_structure_items_minutes_check
  check (minutes > 0 and minutes <= 300);
