alter table if exists public.club_members
  drop constraint if exists club_members_player_course_track_check;

alter table if exists public.club_members
  add constraint club_members_player_course_track_check
  check (
    player_course_track is null
    or nullif(btrim(player_course_track), '') is not null
  );
