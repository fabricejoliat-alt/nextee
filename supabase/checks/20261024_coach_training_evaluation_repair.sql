-- Targeted repair for the reported Competition 1 training; no blanket backfill.
begin;
update public.club_events
set requires_evaluation = true
where id = 'a2e18b4c-13e4-460e-a52f-e11de1b43b0b'
  and event_type = 'training'
  and starts_at = '2026-10-22T11:30:00Z'
  and status = 'scheduled'
  and requires_evaluation = false;
select e.id, e.starts_at, g.name, e.requires_evaluation
from public.club_events e
join public.coach_groups g on g.id = e.group_id
where e.id = 'a2e18b4c-13e4-460e-a52f-e11de1b43b0b';
commit;
