-- Extend the existing camps module without replacing its event-backed days.
-- Existing camp days remain non-evaluable by default; managers can opt in per day.

alter table public.club_camps
  add column if not exists capacity integer null,
  add column if not exists archived_at timestamptz null,
  add column if not exists season_id uuid null references public.club_seasons(id) on delete set null,
  add column if not exists participants_snapshot_at timestamptz null;

alter table public.club_camps
  drop constraint if exists club_camps_capacity_check,
  add constraint club_camps_capacity_check check (capacity is null or capacity > 0),
  drop constraint if exists club_camps_status_check,
  add constraint club_camps_status_check
    check (status in ('draft', 'scheduled', 'cancelled', 'archived'));

create index if not exists idx_club_camps_club_status
  on public.club_camps (club_id, status, created_at desc);
create index if not exists idx_club_camps_season
  on public.club_camps (season_id, created_at desc)
  where season_id is not null;

alter table public.club_camp_days
  add column if not exists responsible_coach_id uuid null references public.profiles(id) on delete set null,
  add column if not exists evaluation_enabled boolean not null default false;

create index if not exists idx_club_camp_days_responsible_coach
  on public.club_camp_days (responsible_coach_id, starts_at)
  where responsible_coach_id is not null;

-- Options are operational selections only. Pricing/payment fields are deliberately
-- absent so a later billing module can reference assignments without changing them.
create table if not exists public.club_camp_options (
  id uuid primary key default gen_random_uuid(),
  camp_id uuid not null references public.club_camps(id) on delete cascade,
  name text not null,
  description text null,
  is_active boolean not null default true,
  applies_to_all_days boolean not null default true,
  capacity integer null,
  allows_quantity boolean not null default false,
  internal_note text null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(name)) > 0),
  check (capacity is null or capacity > 0),
  unique (camp_id, name)
);

create index if not exists idx_club_camp_options_camp_order
  on public.club_camp_options (camp_id, sort_order, created_at);

create table if not exists public.club_camp_option_days (
  option_id uuid not null references public.club_camp_options(id) on delete cascade,
  camp_day_id uuid not null references public.club_camp_days(id) on delete cascade,
  primary key (option_id, camp_day_id)
);

create index if not exists idx_club_camp_option_days_day
  on public.club_camp_option_days (camp_day_id, option_id);

create table if not exists public.club_camp_player_options (
  option_id uuid not null references public.club_camp_options(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  quantity integer not null default 1,
  note text null,
  assigned_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (option_id, player_id),
  check (quantity > 0)
);

create index if not exists idx_club_camp_player_options_player
  on public.club_camp_player_options (player_id, option_id);

alter table public.club_camp_options enable row level security;
alter table public.club_camp_option_days enable row level security;
alter table public.club_camp_player_options enable row level security;

-- Writes and sensitive operational reads go through the manager/coach APIs, where
-- the caller's active club membership is checked. No direct client policy is added.

