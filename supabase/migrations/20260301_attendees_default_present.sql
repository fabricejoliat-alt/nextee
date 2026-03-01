-- Normalize club event attendance statuses to "present" by default.
-- Requirement: new club training attendees should start as present.

alter table if exists public.club_event_attendees
  alter column status set default 'present';

-- One-time normalization requested by product:
-- convert all absent/expected rows to present.
update public.club_event_attendees
set status = 'present'
where status in ('absent', 'expected')
  or status is null;

-- Safety net: when new attendee rows are inserted without a final status,
-- normalize expected/null to present.
create or replace function public.normalize_club_event_attendee_initial_status()
returns trigger
language plpgsql
as $$
begin
  if new.status is null or new.status = 'expected' then
    new.status := 'present';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_club_event_attendee_initial_status on public.club_event_attendees;
create trigger trg_normalize_club_event_attendee_initial_status
before insert on public.club_event_attendees
for each row
execute function public.normalize_club_event_attendee_initial_status();

