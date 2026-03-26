alter table if exists public.club_player_fields
  add column if not exists applies_to_roles text[] not null default array['player']::text[];

update public.club_player_fields
set applies_to_roles = array['player']::text[]
where applies_to_roles is null
   or coalesce(array_length(applies_to_roles, 1), 0) = 0;

alter table if exists public.club_player_fields
  drop constraint if exists club_player_fields_applies_to_roles_check;

alter table if exists public.club_player_fields
  add constraint club_player_fields_applies_to_roles_check
  check (
    coalesce(array_length(applies_to_roles, 1), 0) > 0
    and applies_to_roles <@ array['player', 'parent', 'coach', 'manager']::text[]
  );
