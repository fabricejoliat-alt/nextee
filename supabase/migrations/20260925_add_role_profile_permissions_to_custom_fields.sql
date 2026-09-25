-- Role-specific access to custom fields from Player and Coach profiles.
-- Keep the former generic flags in sync for backward compatibility.

alter table public.club_player_fields
  add column if not exists visible_to_player boolean not null default false,
  add column if not exists editable_by_player boolean not null default false,
  add column if not exists visible_to_coach boolean not null default false,
  add column if not exists editable_by_coach boolean not null default false;

update public.club_player_fields
set
  visible_to_player = visible_in_profile and 'player' = any(applies_to_roles),
  editable_by_player = editable_in_profile and 'player' = any(applies_to_roles),
  visible_to_coach = visible_in_profile and 'coach' = any(applies_to_roles),
  editable_by_coach = editable_in_profile and 'coach' = any(applies_to_roles);

alter table public.club_player_fields
  drop constraint if exists club_player_fields_role_profile_permissions_check,
  add constraint club_player_fields_role_profile_permissions_check check (
    (visible_to_player or not editable_by_player)
    and (visible_to_coach or not editable_by_coach)
  );
