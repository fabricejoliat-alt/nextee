create table if not exists public.player_camps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  coach_name text null,
  notes text null,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.player_camps
  drop constraint if exists player_camps_status_check;

alter table if exists public.player_camps
  add constraint player_camps_status_check
  check (status in ('scheduled', 'cancelled'));

create index if not exists idx_player_camps_user_created
  on public.player_camps (user_id, created_at desc);

create table if not exists public.player_camp_days (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.player_camps(id) on delete cascade,
  session_id uuid not null unique references public.training_sessions(id) on delete cascade,
  day_index integer not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location_text text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_player_camp_days_camp_day
  on public.player_camp_days (camp_id, day_index);

create index if not exists idx_player_camp_days_session
  on public.player_camp_days (session_id);

create index if not exists idx_player_camp_days_camp_start
  on public.player_camp_days (camp_id, starts_at, day_index);
