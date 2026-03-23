alter table if exists public.club_camp_days
  add column if not exists starts_at timestamptz null,
  add column if not exists ends_at timestamptz null,
  add column if not exists location_text text null;

update public.club_camp_days d
set
  starts_at = e.starts_at,
  ends_at = e.ends_at,
  location_text = e.location_text
from public.club_events e
where e.id = d.event_id
  and (
    d.starts_at is null
    or d.ends_at is null
    or d.location_text is null
  );

create index if not exists idx_club_camp_days_camp_start
  on public.club_camp_days (camp_id, starts_at, day_index);
