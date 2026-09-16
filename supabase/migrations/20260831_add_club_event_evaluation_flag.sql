-- Evaluation is opt-in for newly created activities. Preserve the historical
-- behaviour for existing trainings and interclubs so they remain actionable.
alter table public.club_events
  add column if not exists requires_evaluation boolean not null default false;

update public.club_events
set requires_evaluation = true
where event_type in ('training', 'interclub')
  and requires_evaluation = false;

create index if not exists club_events_requires_evaluation_idx
  on public.club_events (requires_evaluation)
  where requires_evaluation = true;
