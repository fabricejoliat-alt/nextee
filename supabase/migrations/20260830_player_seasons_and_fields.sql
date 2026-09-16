-- Durable junior-management model. Existing profile and membership data remains
-- untouched; legacy course/payment values can be copied into the first season by
-- the protected manager API when a club starts using seasons.

alter table public.club_player_fields
  add column if not exists scope text not null default 'permanent',
  add column if not exists description text null,
  add column if not exists is_required boolean not null default false,
  add column if not exists visibility text not null default 'manager',
  add column if not exists editable_by text not null default 'manager',
  add column if not exists is_sensitive boolean not null default false;

alter table public.club_player_fields
  drop constraint if exists club_player_fields_scope_check,
  add constraint club_player_fields_scope_check check (scope in ('permanent', 'season')),
  drop constraint if exists club_player_fields_field_type_check,
  add constraint club_player_fields_field_type_check check (field_type in ('text', 'short_text', 'long_text', 'number', 'date', 'select', 'radio', 'checkbox', 'boolean')),
  drop constraint if exists club_player_fields_visibility_check,
  add constraint club_player_fields_visibility_check check (visibility in ('manager', 'staff', 'player', 'restricted')),
  drop constraint if exists club_player_fields_editable_by_check,
  add constraint club_player_fields_editable_by_check check (editable_by in ('manager', 'staff', 'player', 'none')),
  drop constraint if exists club_player_fields_sensitive_check,
  add constraint club_player_fields_sensitive_check check (not is_sensitive or visibility = 'restricted');

create table if not exists public.club_seasons (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (club_id, name)
);
create unique index if not exists club_seasons_one_current_per_club on public.club_seasons (club_id) where is_current;

create table if not exists public.club_player_season_records (
  id uuid primary key default gen_random_uuid(),
  club_season_id uuid not null references public.club_seasons(id) on delete cascade,
  club_member_id uuid not null references public.club_members(id) on delete cascade,
  course_label text null,
  group_id uuid null references public.coach_groups(id) on delete set null,
  registration_status text not null default 'active' check (registration_status in ('draft', 'active', 'waitlist', 'cancelled', 'completed')),
  membership_status text not null default 'pending' check (membership_status in ('pending', 'paid', 'waived', 'overdue')),
  playing_right_status text not null default 'pending' check (playing_right_status in ('pending', 'paid', 'waived', 'not_applicable')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_season_id, club_member_id)
);
create index if not exists club_player_season_records_member_idx on public.club_player_season_records (club_member_id, club_season_id);
create index if not exists club_player_season_records_filter_idx on public.club_player_season_records (club_season_id, group_id, registration_status, membership_status, playing_right_status);

create table if not exists public.club_player_season_field_values (
  club_player_season_record_id uuid not null references public.club_player_season_records(id) on delete cascade,
  field_id uuid not null references public.club_player_fields(id) on delete cascade,
  value_json jsonb null,
  updated_at timestamptz not null default now(),
  primary key (club_player_season_record_id, field_id)
);

-- Sensitive values deliberately live outside the generic value stores. They are
-- never selected by player-facing APIs and cannot be exported by default.
create table if not exists public.club_member_sensitive_field_values (
  club_member_id uuid not null references public.club_members(id) on delete cascade,
  field_id uuid not null references public.club_player_fields(id) on delete cascade,
  value_encrypted text null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (club_member_id, field_id)
);

alter table public.club_seasons enable row level security;
alter table public.club_player_season_records enable row level security;
alter table public.club_player_season_field_values enable row level security;
alter table public.club_member_sensitive_field_values enable row level security;

-- All writes flow through protected manager APIs. Direct client access is kept
-- read-only for the manager's own club; no policy is created for sensitive data.
drop policy if exists "club_managers_read_seasons" on public.club_seasons;
create policy "club_managers_read_seasons" on public.club_seasons for select to authenticated using (
  exists (select 1 from public.club_members cm where cm.club_id = club_seasons.club_id and cm.user_id = auth.uid() and cm.role = 'manager' and cm.is_active = true)
);
drop policy if exists "club_managers_read_player_seasons" on public.club_player_season_records;
create policy "club_managers_read_player_seasons" on public.club_player_season_records for select to authenticated using (
  exists (select 1 from public.club_seasons s join public.club_members cm on cm.club_id = s.club_id where s.id = club_player_season_records.club_season_id and cm.user_id = auth.uid() and cm.role = 'manager' and cm.is_active = true)
);
