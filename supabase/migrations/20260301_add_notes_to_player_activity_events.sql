-- Add free-text notes for player-created competition/camp events.

alter table if exists public.player_activity_events
  add column if not exists notes text;

