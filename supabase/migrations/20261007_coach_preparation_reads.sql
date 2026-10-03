-- Explicit acknowledgement, scoped to the coach and the exact private-note version.
-- API checks event access, assistance permission, attendance and the live fingerprint.
begin;
create table if not exists public.coach_training_preparation_reads (
  target_event_id uuid not null,
  player_id uuid not null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  seen_at timestamptz not null default now(),
  primary key (target_event_id, player_id, coach_id),
  foreign key (target_event_id, player_id)
    references public.coach_training_preparation_insights(target_event_id, player_id) on delete cascade
);
create index if not exists coach_preparation_reads_coach_event
  on public.coach_training_preparation_reads(coach_id, target_event_id);
alter table public.coach_training_preparation_reads enable row level security;
revoke all on public.coach_training_preparation_reads from public, anon, authenticated;
grant all on public.coach_training_preparation_reads to service_role;
commit;
