-- Ordre du Merite (OM) - core schema (non-breaking).
-- Goal: add metadata + storage to compute and display OM without breaking existing flows.

-- ---------------------------------------------------------------------------
-- Helper functions for organization permissions (RLS-safe, no recursion).
-- ---------------------------------------------------------------------------
create or replace function public.is_org_manager_member(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = p_user_id
      and om.is_active = true
      and om.role in ('owner', 'admin', 'manager')
  )
  or exists (
    select 1
    from public.club_members cm
    where cm.club_id = p_org_id
      and cm.user_id = p_user_id
      and cm.is_active = true
      and cm.role = 'manager'
  );
$$;

create or replace function public.is_org_staff_member(p_org_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_manager_member(p_org_id, p_user_id)
  or exists (
    select 1
    from public.organization_members om
    where om.organization_id = p_org_id
      and om.user_id = p_user_id
      and om.is_active = true
      and om.role in ('coach', 'staff')
  )
  or exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = p_user_id
    where g.organization_id = p_org_id
      and (
        g.head_coach_user_id = p_user_id
        or cgc.coach_user_id is not null
      )
  )
  or exists (
    select 1
    from public.coach_groups g
    left join public.coach_group_coaches cgc
      on cgc.group_id = g.id
      and cgc.coach_user_id = p_user_id
    where g.club_id = p_org_id
      and (
        g.head_coach_user_id = p_user_id
        or cgc.coach_user_id is not null
      )
  );
$$;

grant execute on function public.is_org_manager_member(uuid, uuid) to authenticated;
grant execute on function public.is_org_staff_member(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Exceptional tournaments list (manager-manageable, organization-scoped).
-- ---------------------------------------------------------------------------
create table if not exists public.om_exceptional_tournaments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create index if not exists idx_om_exceptional_tournaments_org_active
  on public.om_exceptional_tournaments (organization_id, is_active);

alter table if exists public.om_exceptional_tournaments enable row level security;

drop policy if exists "org_staff_can_select_om_exceptional_tournaments" on public.om_exceptional_tournaments;
create policy "org_staff_can_select_om_exceptional_tournaments"
on public.om_exceptional_tournaments
for select
to authenticated
using (
  public.is_org_staff_member(om_exceptional_tournaments.organization_id, auth.uid())
);

drop policy if exists "org_managers_can_manage_om_exceptional_tournaments" on public.om_exceptional_tournaments;
create policy "org_managers_can_manage_om_exceptional_tournaments"
on public.om_exceptional_tournaments
for all
to authenticated
using (
  public.is_org_manager_member(om_exceptional_tournaments.organization_id, auth.uid())
)
with check (
  public.is_org_manager_member(om_exceptional_tournaments.organization_id, auth.uid())
);

-- ---------------------------------------------------------------------------
-- Add OM metadata to golf_rounds (competition rounds).
-- NOTE: constraints are permissive for now to avoid breaking current inserts.
-- App layer will progressively enforce required fields.
-- ---------------------------------------------------------------------------
alter table if exists public.golf_rounds
  add column if not exists om_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists om_competition_level text,
  add column if not exists om_competition_format text,
  add column if not exists om_rounds_18_count smallint,
  add column if not exists om_match_play_wins integer not null default 0,
  add column if not exists om_exceptional_tournament_id uuid references public.om_exceptional_tournaments(id) on delete set null,
  add column if not exists om_is_exceptional boolean not null default false,
  add column if not exists om_stats_submitted_at timestamptz,
  add column if not exists om_points_net numeric(10,2),
  add column if not exists om_points_brut numeric(10,2),
  add column if not exists om_points_bonus_net numeric(10,2) not null default 0,
  add column if not exists om_points_bonus_brut numeric(10,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_om_competition_level_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_om_competition_level_check
      check (
        om_competition_level is null
        or om_competition_level in ('club_internal', 'club_official', 'regional', 'national', 'international')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_om_competition_format_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_om_competition_format_check
      check (
        om_competition_format is null
        or om_competition_format in ('stroke_play_individual', 'match_play_individual')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_om_rounds_18_count_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_om_rounds_18_count_check
      check (
        om_rounds_18_count is null
        or om_rounds_18_count in (1,2,3,4)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'golf_rounds_om_match_play_wins_check'
  ) then
    alter table public.golf_rounds
      add constraint golf_rounds_om_match_play_wins_check
      check (om_match_play_wins >= 0);
  end if;
end $$;

create index if not exists idx_golf_rounds_om_org_start
  on public.golf_rounds (om_organization_id, start_at desc)
  where om_organization_id is not null;

create index if not exists idx_golf_rounds_om_level
  on public.golf_rounds (om_competition_level)
  where om_competition_level is not null;

-- ---------------------------------------------------------------------------
-- Tournament score breakdown per round (computed snapshot).
-- ---------------------------------------------------------------------------
create table if not exists public.om_tournament_scores (
  round_id uuid primary key references public.golf_rounds(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  competition_level text not null check (competition_level in ('club_internal', 'club_official', 'regional', 'national', 'international')),
  competition_format text not null check (competition_format in ('stroke_play_individual', 'match_play_individual')),
  rounds_18_count smallint not null check (rounds_18_count in (1,2,3,4)),
  coefficient numeric(4,2) not null,
  score_gross numeric(8,2) not null,
  score_net numeric(8,2) not null,
  course_rating numeric(6,1) not null,
  slope_rating integer not null,
  base_points_brut numeric(10,2) not null,
  base_points_net numeric(10,2) not null,
  bonus_holes_points_brut numeric(10,2) not null default 0,
  bonus_holes_points_net numeric(10,2) not null default 0,
  bonus_match_play_points_brut numeric(10,2) not null default 0,
  bonus_match_play_points_net numeric(10,2) not null default 0,
  bonus_exceptional_points_brut numeric(10,2) not null default 0,
  bonus_exceptional_points_net numeric(10,2) not null default 0,
  total_points_brut numeric(10,2) not null,
  total_points_net numeric(10,2) not null,
  calculated_at timestamptz not null default now()
);

create index if not exists idx_om_tournament_scores_org_player
  on public.om_tournament_scores (organization_id, player_id, calculated_at desc);

alter table if exists public.om_tournament_scores enable row level security;

drop policy if exists "org_staff_can_select_om_tournament_scores" on public.om_tournament_scores;
create policy "org_staff_can_select_om_tournament_scores"
on public.om_tournament_scores
for select
to authenticated
using (
  public.is_org_staff_member(om_tournament_scores.organization_id, auth.uid())
  or om_tournament_scores.player_id = auth.uid()
  or exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = om_tournament_scores.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "org_managers_can_manage_om_tournament_scores" on public.om_tournament_scores;
create policy "org_managers_can_manage_om_tournament_scores"
on public.om_tournament_scores
for all
to authenticated
using (
  public.is_org_manager_member(om_tournament_scores.organization_id, auth.uid())
)
with check (
  public.is_org_manager_member(om_tournament_scores.organization_id, auth.uid())
);

-- ---------------------------------------------------------------------------
-- Bonus points ledger (attendance, participation, contests, manual adjustments).
-- ---------------------------------------------------------------------------
create table if not exists public.om_bonus_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  bonus_type text not null check (
    bonus_type in (
      'training_presence',
      'camp_day_presence',
      'competition_participation_club',
      'competition_participation_regional',
      'competition_participation_national',
      'competition_participation_international',
      'internal_contest_podium',
      'manual_adjustment'
    )
  ),
  points_net numeric(10,2) not null default 0,
  points_brut numeric(10,2) not null default 0,
  source_table text,
  source_id uuid,
  description text,
  occurred_on date not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_om_bonus_entries_org_player_date
  on public.om_bonus_entries (organization_id, player_id, occurred_on desc);

create index if not exists idx_om_bonus_entries_source
  on public.om_bonus_entries (source_table, source_id);

alter table if exists public.om_bonus_entries enable row level security;

drop policy if exists "org_staff_can_select_om_bonus_entries" on public.om_bonus_entries;
create policy "org_staff_can_select_om_bonus_entries"
on public.om_bonus_entries
for select
to authenticated
using (
  public.is_org_staff_member(om_bonus_entries.organization_id, auth.uid())
  or om_bonus_entries.player_id = auth.uid()
  or exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = om_bonus_entries.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "org_managers_can_manage_om_bonus_entries" on public.om_bonus_entries;
create policy "org_managers_can_manage_om_bonus_entries"
on public.om_bonus_entries
for all
to authenticated
using (
  public.is_org_manager_member(om_bonus_entries.organization_id, auth.uid())
)
with check (
  public.is_org_manager_member(om_bonus_entries.organization_id, auth.uid())
);

-- ---------------------------------------------------------------------------
-- Internal contests (manager-managed), with complete ranking JSON + per-player rows.
-- ---------------------------------------------------------------------------
create table if not exists public.om_internal_contests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid references public.coach_groups(id) on delete set null,
  event_id uuid references public.club_events(id) on delete set null,
  title text not null,
  description text,
  contest_date date not null,
  full_ranking jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_om_internal_contests_org_date
  on public.om_internal_contests (organization_id, contest_date desc);

alter table if exists public.om_internal_contests enable row level security;

drop policy if exists "org_staff_can_select_om_internal_contests" on public.om_internal_contests;
create policy "org_staff_can_select_om_internal_contests"
on public.om_internal_contests
for select
to authenticated
using (
  public.is_org_staff_member(om_internal_contests.organization_id, auth.uid())
);

drop policy if exists "org_managers_can_manage_om_internal_contests" on public.om_internal_contests;
create policy "org_managers_can_manage_om_internal_contests"
on public.om_internal_contests
for all
to authenticated
using (
  public.is_org_manager_member(om_internal_contests.organization_id, auth.uid())
)
with check (
  public.is_org_manager_member(om_internal_contests.organization_id, auth.uid())
);

create table if not exists public.om_internal_contest_results (
  contest_id uuid not null references public.om_internal_contests(id) on delete cascade,
  player_id uuid not null references public.profiles(id) on delete cascade,
  rank integer not null check (rank > 0),
  points_net numeric(10,2) not null default 0,
  points_brut numeric(10,2) not null default 0,
  note text,
  created_at timestamptz not null default now(),
  primary key (contest_id, player_id)
);

create index if not exists idx_om_internal_contest_results_player
  on public.om_internal_contest_results (player_id, created_at desc);

alter table if exists public.om_internal_contest_results enable row level security;

drop policy if exists "org_staff_can_select_om_internal_contest_results" on public.om_internal_contest_results;
create policy "org_staff_can_select_om_internal_contest_results"
on public.om_internal_contest_results
for select
to authenticated
using (
  exists (
    select 1
    from public.om_internal_contests c
    where c.id = om_internal_contest_results.contest_id
      and public.is_org_staff_member(c.organization_id, auth.uid())
  )
  or om_internal_contest_results.player_id = auth.uid()
  or exists (
    select 1
    from public.player_guardians pg
    where pg.player_id = om_internal_contest_results.player_id
      and pg.guardian_user_id = auth.uid()
      and coalesce(pg.can_view, true) = true
  )
);

drop policy if exists "org_managers_can_manage_om_internal_contest_results" on public.om_internal_contest_results;
create policy "org_managers_can_manage_om_internal_contest_results"
on public.om_internal_contest_results
for all
to authenticated
using (
  exists (
    select 1
    from public.om_internal_contests c
    where c.id = om_internal_contest_results.contest_id
      and public.is_org_manager_member(c.organization_id, auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.om_internal_contests c
    where c.id = om_internal_contest_results.contest_id
      and public.is_org_manager_member(c.organization_id, auth.uid())
  )
);

-- ---------------------------------------------------------------------------
-- Useful utility functions for OM period logic.
-- ---------------------------------------------------------------------------
create or replace function public.om_period_slot(p_ref_date date)
returns smallint
language sql
immutable
as $$
  select case
    when p_ref_date <= make_date(extract(year from p_ref_date)::int, 5, 31) then 1
    when p_ref_date <= make_date(extract(year from p_ref_date)::int, 7, 31) then 2
    else 3
  end::smallint;
$$;

create or replace function public.om_period_limit(p_slot smallint)
returns integer
language sql
immutable
as $$
  select case
    when p_slot = 1 then 5
    when p_slot = 2 then 10
    else 15
  end;
$$;

