-- Apply on isolated TEST after reviewing audit 14. No legal activation or data backfill.
-- These tables had RLS disabled and client grants. Current application access is via
-- service-role server routes, except public translation reads.
begin;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'access_invitation_logs',
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
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
  end loop;
end $$;

-- Translation overrides are intentionally readable by the client. Editing remains
-- on the authenticated Admin API, which writes with service_role after its own check.
alter table public.app_translations enable row level security;
revoke all on table public.app_translations from public,anon,authenticated;
grant select on table public.app_translations to anon,authenticated,service_role;
grant insert,update,delete on table public.app_translations to service_role;
create policy app_translations_public_read on public.app_translations
  for select to anon,authenticated using (true);

commit;
