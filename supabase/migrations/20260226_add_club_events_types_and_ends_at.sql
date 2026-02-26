-- Add event typing + explicit end datetime for planned group events.

alter table if exists public.club_events
  add column if not exists event_type text,
  add column if not exists ends_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_events_event_type_check'
  ) then
    alter table public.club_events
      add constraint club_events_event_type_check
      check (event_type in ('training', 'interclub', 'camp', 'session', 'event'));
  end if;
end $$;

update public.club_events
set event_type = 'training'
where event_type is null;

update public.club_events
set ends_at = starts_at + make_interval(mins => greatest(coalesce(duration_minutes, 60), 0))
where ends_at is null;

alter table if exists public.club_events
  alter column event_type set default 'training';

create index if not exists club_events_event_type_idx
  on public.club_events (event_type);

create index if not exists club_events_ends_at_idx
  on public.club_events (ends_at);

alter table if exists public.club_event_series
  add column if not exists event_type text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'club_event_series_event_type_check'
  ) then
    alter table public.club_event_series
      add constraint club_event_series_event_type_check
      check (event_type in ('training', 'interclub', 'camp', 'session', 'event'));
  end if;
end $$;

update public.club_event_series
set event_type = 'training'
where event_type is null;

alter table if exists public.club_event_series
  alter column event_type set default 'training';
