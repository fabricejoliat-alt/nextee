-- Add optional title for named sessions/events.

alter table if exists public.club_events
  add column if not exists title text;

create index if not exists club_events_title_idx
  on public.club_events (title);

