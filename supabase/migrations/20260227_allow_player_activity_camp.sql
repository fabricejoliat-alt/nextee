-- Extend player activity events to support camp/stage.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'player_activity_events_event_type_check'
  ) then
    alter table public.player_activity_events
      drop constraint player_activity_events_event_type_check;
  end if;
end $$;

alter table if exists public.player_activity_events
  add constraint player_activity_events_event_type_check
  check (event_type in ('competition', 'camp'));

