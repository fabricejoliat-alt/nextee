-- Read-only postflight after 20261027_legal_unprotected_table_privileges.sql on isolated TEST.
-- The 17 private tables must have RLS and no client table privileges.
with names(name) as (values
  ('access_invitation_logs'),('club_access_invitation_mail_configs'),
  ('club_camp_coaches'),('club_camp_days'),('club_camp_groups'),
  ('club_camp_players'),('club_camps'),('club_member_player_field_values'),
  ('club_parent_intake_configs'),('club_player_fields'),('player_camp_days'),
  ('player_camps'),('player_validation_attempts'),('training_volume_settings'),
  ('training_volume_targets'),('validation_exercises'),('validation_sections'),
  ('app_translations')
)
select n.name,c.relrowsecurity as rls_enabled,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  (has_table_privilege('anon',c.oid,'INSERT') or has_table_privilege('anon',c.oid,'UPDATE')
    or has_table_privilege('anon',c.oid,'DELETE')) as anon_write,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
  has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') as authenticated_update,
  has_table_privilege('authenticated',c.oid,'DELETE') as authenticated_delete,
  has_table_privilege('service_role',c.oid,'SELECT') as service_select,
  has_table_privilege('service_role',c.oid,'INSERT') as service_insert,
  has_table_privilege('service_role',c.oid,'UPDATE') as service_update,
  has_table_privilege('service_role',c.oid,'DELETE') as service_delete,
  exists(select 1 from pg_policy p where p.polrelid=c.oid
    and p.polname='app_translations_public_read') as translation_read_policy,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from names n left join pg_class c on c.oid=to_regclass('public.'||n.name)
order by n.name;
