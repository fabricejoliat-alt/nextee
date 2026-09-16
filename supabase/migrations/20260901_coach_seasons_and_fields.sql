-- Coach participation and custom values are scoped to a club season.
create table if not exists public.club_coach_season_records (
  id uuid primary key default gen_random_uuid(),
  club_season_id uuid not null references public.club_seasons(id) on delete cascade,
  club_member_id uuid not null references public.club_members(id) on delete cascade,
  registration_status text not null default 'active' check (registration_status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_season_id, club_member_id)
);

create table if not exists public.club_coach_season_field_values (
  club_coach_season_record_id uuid not null references public.club_coach_season_records(id) on delete cascade,
  field_id uuid not null references public.club_player_fields(id) on delete cascade,
  value_json jsonb null,
  updated_at timestamptz not null default now(),
  primary key (club_coach_season_record_id, field_id)
);

alter table public.club_coach_season_records enable row level security;
alter table public.club_coach_season_field_values enable row level security;
