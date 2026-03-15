alter table if exists public.club_members
  add column if not exists player_course_track text null,
  add column if not exists player_membership_paid boolean null,
  add column if not exists player_playing_right_paid boolean null,
  add column if not exists player_consent_status text null;

alter table if exists public.club_members
  drop constraint if exists club_members_player_course_track_check;

alter table if exists public.club_members
  add constraint club_members_player_course_track_check
  check (
    player_course_track is null
    or player_course_track in ('junior', 'competition')
  );

alter table if exists public.club_members
  drop constraint if exists club_members_player_consent_status_check;

alter table if exists public.club_members
  add constraint club_members_player_consent_status_check
  check (
    player_consent_status is null
    or player_consent_status in ('granted', 'pending', 'adult')
  );

create index if not exists idx_club_members_player_params
  on public.club_members (club_id, role, player_course_track, player_consent_status);
