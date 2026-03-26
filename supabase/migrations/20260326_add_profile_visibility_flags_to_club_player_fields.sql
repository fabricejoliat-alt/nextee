alter table if exists public.club_player_fields
  add column if not exists visible_in_profile boolean not null default false;

alter table if exists public.club_player_fields
  add column if not exists editable_in_profile boolean not null default false;

update public.club_player_fields
set editable_in_profile = false
where visible_in_profile = false
  and editable_in_profile = true;

alter table if exists public.club_player_fields
  drop constraint if exists club_player_fields_profile_visibility_check;

alter table if exists public.club_player_fields
  add constraint club_player_fields_profile_visibility_check
  check (visible_in_profile or not editable_in_profile);
