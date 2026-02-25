-- DANGER: destructive reset for application data.
-- Keeps only superadmin identities (app_admins + corresponding profiles).
-- Run manually in Supabase SQL editor when you are ready.

begin;

-- 1) Keep superadmin IDs
create temporary table _keep_admin_ids as
select distinct user_id
from public.app_admins;

-- 2) Clear transactional/domain data
truncate table
  public.club_event_coach_feedback,
  public.club_event_player_feedback,
  public.club_event_coaches,
  public.club_event_attendees,
  public.club_events,
  public.club_event_series,
  public.club_trainings,
  public.training_session_items,
  public.training_sessions,
  public.golf_round_holes,
  public.golf_rounds,
  public.marketplace_images,
  public.marketplace_items,
  public.coach_group_players,
  public.coach_group_coaches,
  public.coach_group_categories,
  public.coach_groups,
  public.club_members,
  public.app_translations,
  public.program_members,
  public.programs,
  public.organization_members,
  public.organizations,
  public.player_guardians
restart identity cascade;

-- 3) Keep only superadmin profiles in app layer
delete from public.profiles p
where not exists (
  select 1
  from _keep_admin_ids k
  where k.user_id = p.id
);

-- 4) Keep only superadmin accounts in auth (optional but recommended).
-- Requires running as a privileged role (Supabase SQL editor is fine).
delete from auth.users u
where not exists (
  select 1
  from _keep_admin_ids k
  where k.user_id = u.id
);

-- 5) Clear legacy clubs too for a fully clean start
delete from public.clubs;

commit;
