-- These tables were observed without RLS on the production main branch.
-- Application access to these tables goes through server routes using service_role.
-- Close direct Data API access, including inherited PUBLIC grants.
begin;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'access_invitation_logs',
    'access_invitation_tokens',
    'app_translations',
    'club_access_invitation_mail_configs',
    'club_camp_coaches',
    'club_camp_days',
    'club_camp_groups',
    'club_camp_players',
    'club_camps',
    'club_member_player_field_values',
    'club_parent_intake_configs',
    'club_player_fields',
    'player_camp_days',
    'player_camps',
    'player_validation_attempts',
    'training_volume_settings',
    'training_volume_targets',
    'validation_exercises',
    'validation_sections'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

commit;
