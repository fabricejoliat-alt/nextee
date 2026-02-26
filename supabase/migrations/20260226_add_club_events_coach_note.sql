-- Free-text details for event preparation (e.g. equipment for camps).

alter table if exists public.club_events
  add column if not exists coach_note text;

alter table if exists public.club_event_series
  add column if not exists coach_note text;
