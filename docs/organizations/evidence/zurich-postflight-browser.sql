begin read only;
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

do $$ begin
  if exists(select 1 from public.clubs c join public.organizations o on o.id=c.id where o.org_type<>'club')
    or exists(select 1 from pg_constraint where contype='f' and confrelid='public.clubs'::regclass)
    or exists(select 1 from public.organization_members m full join public.club_members c
      on c.club_id=m.organization_id and c.user_id=m.user_id and c.role::text=m.role
      where coalesce(m.role,c.role::text) in ('manager','coach','player','parent') and
        (m.organization_id is null or c.id is null or m.is_active is distinct from coalesce(c.is_active,false)
          or m.player_consent_status is distinct from c.player_consent_status))
    or exists(select 1 from public.academy_roster_entries r where r.status='active'
      and not public.organization_player_authorized(r.academy_id,r.player_id))
    or exists(select 1 from public.player_guardian_scopes s left join public.player_guardians g
      on g.player_id=s.player_id and g.guardian_user_id=s.guardian_user_id where g.player_id is null)
    or exists(select 1 from public.training_sessions where club_id is null)
    or exists(select 1 from public.golf_rounds where club_id is null)
    or exists(select 1 from public.player_activity_events where organization_id is null)
    or exists(select 1 from public.player_camps where organization_id is null)
    or exists(select 1 from public.player_validation_attempts where organization_id is null) then
    raise exception 'Organization postflight failed; transaction must be rolled back';
  end if;
end $$;

select 'PASS' as clean_and_postflight, to_regclass('public.organization_migration_baseline') is not null as remodel_present, (select count(*) from public.app_admins) as superadmins, (select count(*) from auth.users) as auth_users, (select count(*) from public.organizations) as organizations, (select count(*) from public.clubs) as clubs, (select count(*) from public.legal_versions) as legal_versions, (select encode(extensions.digest(coalesce(string_agg(id::text||content_sha256,'' order by id),''),'sha256'),'hex') from public.legal_versions) as legal_fingerprint, (select count(*) from public.legal_presentations) as legal_presentations, (select count(*) from public.legal_decisions) as legal_decisions, (select count(*) from public.legal_organization_templates) as legal_templates, (select count(*) from public.rules_cards) as rules_cards, (select count(*) from public.etiquette_cards) as etiquette_cards, (select count(*) from public.validation_exercises) as exercises, (select count(*) from public.training_volume_default_targets) as ftem_defaults, (select count(*) from storage.objects where bucket_id='validation-exercise-images') as illustrations;
rollback;