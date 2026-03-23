create table if not exists public.club_camps (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  title text not null,
  notes text null,
  status text not null default 'scheduled',
  head_coach_user_id uuid null references public.profiles(id) on delete set null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.club_camps
  drop constraint if exists club_camps_status_check;

alter table if exists public.club_camps
  add constraint club_camps_status_check
  check (status in ('scheduled', 'cancelled'));

create index if not exists idx_club_camps_club_created
  on public.club_camps (club_id, created_at desc);

create table if not exists public.club_camp_groups (
  camp_id uuid not null references public.club_camps(id) on delete cascade,
  group_id uuid not null references public.coach_groups(id) on delete cascade,
  primary key (camp_id, group_id)
);

create index if not exists idx_club_camp_groups_group
  on public.club_camp_groups (group_id, camp_id);

create table if not exists public.club_camp_players (
  camp_id uuid not null references public.club_camps(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  registration_status text not null default 'invited',
  registered_at timestamptz null,
  created_at timestamptz not null default now(),
  primary key (camp_id, player_id)
);

alter table if exists public.club_camp_players
  drop constraint if exists club_camp_players_registration_status_check;

alter table if exists public.club_camp_players
  add constraint club_camp_players_registration_status_check
  check (registration_status in ('invited', 'registered', 'declined'));

create index if not exists idx_club_camp_players_player
  on public.club_camp_players (player_id, camp_id);

create table if not exists public.club_camp_coaches (
  camp_id uuid not null references public.club_camps(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  is_head boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (camp_id, coach_id)
);

create index if not exists idx_club_camp_coaches_coach
  on public.club_camp_coaches (coach_id, camp_id);

create table if not exists public.club_camp_days (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.club_camps(id) on delete cascade,
  event_id uuid not null unique references public.club_events(id) on delete cascade,
  day_index integer not null default 0,
  practical_info text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_club_camp_days_camp_day
  on public.club_camp_days (camp_id, day_index);

create index if not exists idx_club_camp_days_event
  on public.club_camp_days (event_id, camp_id);
