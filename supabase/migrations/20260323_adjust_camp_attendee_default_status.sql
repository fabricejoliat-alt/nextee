-- Keep classic club activities defaulting to "present",
-- but make camp days default to "not_registered" until the player opts in.

alter table if exists public.club_event_attendees
  drop constraint if exists club_event_attendees_status_check;

alter table if exists public.club_event_attendees
  add constraint club_event_attendees_status_check
  check (status in ('expected', 'present', 'absent', 'excused', 'not_registered'));

create or replace function public.normalize_club_event_attendee_initial_status()
returns trigger
language plpgsql
as $$
declare
  v_event_type text;
begin
  select e.event_type
  into v_event_type
  from public.club_events e
  where e.id = new.event_id;

  if coalesce(v_event_type, '') = 'camp' then
    if new.status is null or new.status = 'expected' then
      new.status := 'not_registered';
    end if;
  else
    if new.status is null or new.status = 'expected' then
      new.status := 'present';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_club_event_attendee_initial_status on public.club_event_attendees;
create trigger trg_normalize_club_event_attendee_initial_status
before insert on public.club_event_attendees
for each row
execute function public.normalize_club_event_attendee_initial_status();
