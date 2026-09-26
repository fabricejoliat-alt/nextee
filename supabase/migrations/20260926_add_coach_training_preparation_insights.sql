-- Cached per-player preparation checklists for future Coach training sessions.
-- The source fingerprint invalidates a checklist as soon as one of the five
-- historical evaluations used to build it changes.

create table if not exists public.coach_training_preparation_insights (
  target_event_id uuid not null references public.club_events(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.clubs(id) on delete cascade,
  group_id uuid not null references public.coach_groups(id) on delete cascade,
  history_event_ids uuid[] not null default '{}'::uuid[],
  source_fingerprint text not null,
  attention_points jsonb not null,
  source_event_count smallint not null default 0,
  model text not null,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_event_id, player_id),
  constraint coach_training_preparation_fingerprint_check
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint coach_training_preparation_points_check
    check (
      jsonb_typeof(attention_points) = 'array'
      and jsonb_array_length(attention_points) between 1 and 4
    ),
  constraint coach_training_preparation_source_count_check
    check (source_event_count between 1 and 5)
);

create index if not exists idx_coach_training_preparation_player
  on public.coach_training_preparation_insights (player_id, generated_at desc);

alter table public.coach_training_preparation_insights enable row level security;

revoke all on public.coach_training_preparation_insights from public, anon, authenticated;
grant all on public.coach_training_preparation_insights to service_role;
