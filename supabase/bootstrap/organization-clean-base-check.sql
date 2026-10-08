-- Stop before any migration/backup if real organization or user data exists.
-- This script never deletes data. It is safe inside a read-only transaction.
do $$ declare tbl text; occupied boolean; begin
  if (select count(*) from public.app_admins)<>1 or (select count(*) from auth.users)<>1
    or (select count(*) from public.profiles)<>1 or exists(select 1 from auth.users u left join public.app_admins a on a.user_id=u.id where a.user_id is null)
    or exists(select 1 from public.profiles p left join public.app_admins a on a.user_id=p.id where a.user_id is null) then
    raise exception 'Clean base requires exactly the existing superadmin identity';
  end if;
  foreach tbl in array array['clubs','organizations','club_members','organization_members','programs','program_members',
    'coach_groups','coach_group_players','coach_group_coaches','club_seasons','club_events','club_event_attendees',
    'club_camps','club_camp_players','club_news','club_trainings','player_guardians','notifications','notification_recipients',
    'rules_quiz_attempts','player_validation_attempts','training_sessions','golf_rounds','player_camps','player_activity_events',
    'message_threads','player_dashboard_documents','player_periodic_reports','player_periodic_report_configs',
    'coach_player_private_notes','coach_training_debriefs','organization_relationships','academy_roster_entries',
    'external_club_references','organization_identity_matches','player_guardian_scopes','organization_audit_events'] loop
    if to_regclass('public.'||tbl) is null then continue; end if;
    execute format('select exists(select 1 from public.%I)',tbl) into occupied;
    if occupied then raise exception 'Base is not club free: % contains records. No automatic cleanup is allowed.',tbl; end if;
  end loop;
  if exists(select 1 from public.legal_documents where scope<>'platform' or club_id is not null or document_key like 'legalqa_%') then
    raise exception 'Organization legal records or fixtures remain';
  end if;
  if (select count(*) from public.legal_documents where scope='platform' and active)<3
    or (select count(*) from public.legal_club_templates)<3
    or (select count(*) from public.rules_series)<12 or (select count(*) from public.rules_cards)<72
    or (select count(*) from public.rules_questions)<216 or (select count(*) from public.etiquette_themes)<12
    or (select count(*) from public.etiquette_cards)<36 or (select count(*) from public.validation_sections)<4
    or (select count(*) from public.validation_exercises)<60 or (select count(*) from public.training_volume_default_targets)<10 then
    raise exception 'Required legal/reference catalogs are incomplete';
  end if;
  if (select count(*) from public.validation_exercises where illustration_url like 'https://soivxpdcilgltbjbpimt.supabase.co/%')<40
    or exists(select 1 from public.validation_exercises where illustration_url is not null and illustration_url not like 'https://soivxpdcilgltbjbpimt.supabase.co/%') then
    raise exception 'Zurich illustration links are incomplete or foreign';
  end if;
end $$;
select 'clean_superadmin_reference_base' as check_name, 'PASS' as result;
