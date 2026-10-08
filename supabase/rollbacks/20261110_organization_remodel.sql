-- Maintenance-only rollback before organization workflows have been used.
-- Any new affiliation/audit evidence makes automatic rollback unsafe: restore
-- a reviewed backup or write a forward migration instead. No evidence is erased.
begin;
do $$ declare original jsonb; current_members jsonb; checkpoint record; fingerprint text; begin
  for checkpoint in select object_key,definition from public.organization_migration_baseline where object_key like 'prepared_table:%' order by object_key loop
    execute format('lock table public.%I in access exclusive mode',split_part(checkpoint.object_key,':',2));
    execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,'''' order by to_jsonb(r)::text),'''')) from public.%I r',split_part(checkpoint.object_key,':',2)) into fingerprint;
    if fingerprint is distinct from checkpoint.definition then raise exception 'Rollback denied: records changed in %',split_part(checkpoint.object_key,':',2); end if;
  end loop;
  if exists(select 1 from public.organization_audit_events)
    or exists(select 1 from public.legal_documents where scope='organization')
    or exists(select 1 from public.organization_identity_matches)
    or exists(select 1 from public.external_club_references) then raise exception 'Rollback denied: organization workflow history exists'; end if;
  if exists(select 1 from public.organization_migration_baseline b join public.legal_drafts dr on dr.document_id=split_part(b.object_key,':',2)::uuid
    where b.object_key like 'privacy_prepared:%' and to_jsonb(dr) is distinct from b.definition::jsonb) then
    raise exception 'Rollback denied: prepared privacy draft changed'; end if;
  if exists(select 1 from public.notifications where id::text not in
    (select jsonb_object_keys(definition::jsonb) from public.organization_migration_baseline where object_key='notification_owners_before')) then
    raise exception 'Rollback denied: notifications created'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) into current_members from public.club_members t;
  if current_members is distinct from (select definition::jsonb from public.organization_migration_baseline where object_key='club_members_before') then
    raise exception 'Rollback denied: memberships changed'; end if;
end $$;


do $$ declare t regclass; begin
  for t in select tgrelid::regclass from pg_trigger where tgname='organization_sports_child_write' loop
    execute format('drop trigger organization_sports_child_write on %s',t);
  end loop;
end $$;
-- Remove only the restrictive policies introduced by these migrations.
do $$ declare p record; begin
  for p in select polname,polrelid::regclass tbl from pg_policy
    where polname='organization_personal_history' or polname='organization_scope_guard' or polname like 'organization_parent_%' or polname like 'organization_legal_%' or polname='organization_notification_read' or polname='organization_view_scope' or polname='organization_member_visibility' loop
    execute format('drop policy %I on %s',p.polname,p.tbl);
  end loop;
end $$;
do $$ declare tbl text; begin
  foreach tbl in array array['training_sessions','golf_rounds','player_activity_events','player_camps'] loop
    execute format('drop trigger organization_sports_owner on public.%I',tbl);
  end loop;
end $$;
alter policy legal_required_direct_access on public.golf_rounds
using(public.legal_required_direct_access(om_organization_id)) with check(public.legal_required_direct_access(om_organization_id));
alter table public.training_sessions alter column club_id drop not null;
alter table public.golf_rounds alter column club_id drop not null;
update public.training_sessions t set club_id=nullif(b.definition::jsonb->>t.id::text,'')::uuid
  from public.organization_migration_baseline b where b.object_key='sports_owner:training_sessions';
update public.golf_rounds t set club_id=nullif(b.definition::jsonb->>t.id::text,'')::uuid
  from public.organization_migration_baseline b where b.object_key='sports_owner:golf_rounds';
drop trigger organization_validation_owner on public.player_validation_attempts;
alter table public.player_validation_attempts drop column organization_id;
alter table public.player_activity_events drop column organization_id;
alter table public.player_camps drop column organization_id;
drop trigger organization_membership_roster on public.organization_members;
do $$ declare privilege jsonb; begin
  for privilege in select value from jsonb_array_elements((select definition::jsonb from public.organization_migration_baseline where object_key='membership_privileges')) loop
    execute format('grant %s on public.%I to %I',privilege->>'privilege',privilege->>'table',privilege->>'role');
  end loop;
end $$;
drop trigger notification_organization_scope on public.notifications;
drop trigger notification_organization_recipient on public.notification_recipients;
update public.notifications n set club_id=nullif(b.definition::jsonb->>n.id::text,'')::uuid
  from public.organization_migration_baseline b where b.object_key='notification_owners_before';
drop trigger organization_member_compatibility on public.organization_members;
drop trigger club_member_compatibility on public.club_members;
drop trigger organization_club_identity on public.organizations;
drop trigger organization_new_legal_version on public.legal_versions;
drop trigger organization_legal_scope_transition on public.legal_current_state;
drop trigger if exists seed_new_organization_training_volume on public.organizations;

-- Restore pre-cutover functions, including bootstrap legal templates.
do $$ declare r record; begin
  for r in select definition from public.organization_migration_baseline where object_key like 'function:%' loop execute r.definition; end loop;
  for r in select definition::jsonb data from public.organization_migration_baseline where object_key like 'privacy_draft:%' loop
    update public.legal_drafts set source_revision=(r.data->>'source_revision')::integer,
      change_summary=r.data->>'change_summary',allowed_variables=array(select jsonb_array_elements_text(r.data->'allowed_variables')),
      translations=r.data->'translations',updated_by=(r.data->>'updated_by')::uuid,updated_at=(r.data->>'updated_at')::timestamptz
      where document_id=(r.data->>'document_id')::uuid;
  end loop;
end $$;
drop table public.legal_organization_templates;
drop policy roster_read on public.academy_roster_entries;
drop policy external_reference_read on public.external_club_references;
drop table public.player_guardian_scopes;
drop table public.academy_roster_entries;
drop table public.organization_relationships;
drop table public.organization_identity_matches;
drop table public.external_club_references;
drop table public.organization_audit_events;

-- Restore the old clubs registry before restoring its foreign keys.
insert into public.clubs select * from jsonb_populate_recordset(null::public.clubs,
  (select definition::jsonb from public.organization_migration_baseline where object_key='clubs_before'))
on conflict(id) do nothing;
do $$ declare r record; begin
  for r in select object_key,definition from public.organization_migration_baseline where object_key like 'fk:%' loop
    execute format('alter table %s drop constraint %I',split_part(r.object_key,':',2),split_part(r.object_key,':',3));
    execute format('alter table %s add constraint %I %s',split_part(r.object_key,':',2),split_part(r.object_key,':',3),r.definition);
  end loop;
  for r in select conrelid::regclass tbl from pg_constraint where conname='organization_owner_consistent' loop
    execute format('alter table %s drop constraint organization_owner_consistent',r.tbl);
  end loop;
end $$;
alter table public.organization_members drop column is_performance,drop column player_consent_status,
  drop column can_manage_assigned_groups,drop column can_manage_assigned_group_planning,
  drop column can_transfer_players_between_club_groups,drop column coach_training_assistance_enabled;
delete from public.organization_members;
insert into public.organization_members select * from jsonb_populate_recordset(null::public.organization_members,
  (select definition::jsonb from public.organization_migration_baseline where object_key='organization_members_before'));
alter table public.legal_documents drop column organization_id;
alter table public.legal_presentations drop column organization_id;
alter table public.legal_decisions drop column organization_id;
alter table public.legal_representative_assertions drop column organization_id;
alter table public.legal_representative_events drop column organization_id;
alter table public.legal_conflict_resolutions drop column organization_id;
alter table public.legal_current_state drop column organization_scope;
alter table public.legal_documents drop constraint legal_documents_scope_check,drop constraint legal_documents_check;
alter table public.legal_documents add constraint legal_documents_scope_check check(scope in ('platform','club'));
alter table public.legal_documents add constraint legal_documents_check check
  ((scope='platform' and club_id is null) or (scope='club' and club_id is not null));
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('organization_access_summary_checked','organization_actor_access','organization_actor_legal_ready',
      'organization_guardian_allowed','organization_player_authorized','set_academy_roster_status_checked',
      'organization_legal_scope_transition','create_organization_checked','sync_organization_members_compatibility',
      'sync_organization_club_identity','organization_is_manager','organization_require_actor','organization_validate_structure',
      'organization_audit_transition','set_academy_partnership_checked','discover_academy_players_checked',
      'request_academy_roster_checked','approve_academy_source_checked','claim_external_club_checked',
      'confirm_external_affiliation_checked','request_organization_identity_checked','review_organization_identity_checked',
      'create_external_reference_checked','provision_academy_family_checked','save_organization_settings_checked',
      'delete_empty_organization_checked','attach_academy_guardian_checked','organization_template_text',
      'organization_personal_history_notice','personal_player_access','player_history_access','organization_event_player_access','organization_sports_child_write','organization_validation_owner','organization_new_legal_version','provision_academy_guardian_checked','organization_view_scope','organization_sports_owner','organization_membership_roster_guard','set_organization_manager_checked','organization_notification_scope','organization_notification_recipient','organization_notification_visible','organization_notification_owner') order by case when p.proname='organization_notification_owner' then 1 else 0 end loop execute format('drop function %s',f); end loop;
  if to_regprocedure('public.seed_new_club_training_volume()') is not null then
    execute 'create trigger seed_new_club_training_volume after insert on public.clubs for each row execute function public.seed_new_club_training_volume()';
  end if;
end $$;
-- Remove only identities backfilled from legacy clubs by this migration.
-- Prepared-table hashes above guarantee no new organization work has occurred.
delete from public.organizations where id not in (select (value->>'id')::uuid from jsonb_array_elements(
  (select definition::jsonb from public.organization_migration_baseline where object_key='organizations_before')));
drop table public.organization_migration_baseline;
notify pgrst,'reload schema';
commit;
