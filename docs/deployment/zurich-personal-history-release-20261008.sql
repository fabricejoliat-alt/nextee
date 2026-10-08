-- Zurich only: apply the missing personal-history correction after the 16-migration remodel.
-- Never imports, creates or deletes clubs, academies or accounts.
begin;
set local lock_timeout='10s';
set local statement_timeout='120s';
lock table public.organizations,public.clubs,public.organization_members,public.profiles,public.app_admins,auth.users in share row exclusive mode;
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

do $$ begin if to_regprocedure('public.personal_player_access(uuid,uuid,boolean)') is not null then raise exception 'Correction already applied; use postflight instead';end if;end $$;
create temporary table zurich_release_before on commit drop as select jsonb_object_agg(name,digest) fingerprints from (select 'public.rules_series' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_series r),'[]')) digest union all select 'public.rules_cards' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_cards r),'[]')) digest union all select 'public.rules_questions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_questions r),'[]')) digest union all select 'public.etiquette_themes' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.etiquette_themes r),'[]')) digest union all select 'public.etiquette_cards' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.etiquette_cards r),'[]')) digest union all select 'public.validation_sections' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.validation_sections r),'[]')) digest union all select 'public.validation_exercises' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.validation_exercises r),'[]')) digest union all select 'public.training_volume_default_targets' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.training_volume_default_targets r),'[]')) digest union all select 'public.legal_club_templates' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_club_templates r),'[]')) digest union all select 'public.legal_versions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_versions r),'[]')) digest union all select 'public.legal_presentations' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_presentations r),'[]')) digest union all select 'public.legal_decisions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_decisions r),'[]')) digest union all select 'public.legal_activation_events' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_activation_events r),'[]')) digest union all select 'public.legal_representative_assertions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_representative_assertions r),'[]')) digest union all select 'public.legal_representative_events' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_representative_events r),'[]')) digest union all select 'auth.users' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from auth.users r),'[]')) digest union all select 'public.profiles' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.profiles r),'[]')) digest union all select 'public.app_admins' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.app_admins r),'[]')) digest union all select 'storage.objects' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from storage.objects r),'[]')) digest union all select 'storage.buckets' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from storage.buckets r),'[]')) digest) records;
-- Player-owned history has no organization owner. Organization context controls
-- access through an authorized affiliation; it does not assign ownership.

alter table public.training_sessions alter column club_id drop not null;
alter table public.golf_rounds alter column club_id drop not null;
alter table public.player_activity_events alter column organization_id drop not null;
alter table public.player_camps alter column organization_id drop not null;
alter table public.player_validation_attempts alter column organization_id drop not null;

create function public.personal_player_access(p_player uuid,p_actor uuid,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select p_player is not null and p_actor is not null and (
    public.is_app_admin(p_actor) or exists(
      select 1 from public.organization_members m where m.user_id=p_player and m.role='player' and m.is_active
        and public.organization_view_scope(m.organization_id)
        and public.organization_player_authorized(m.organization_id,p_player)
        and not exists(select 1 from public.academy_roster_entries r where r.academy_id=m.organization_id and r.player_id=p_player and r.status<>'active')
        and public.organization_actor_legal_ready(m.organization_id,p_actor)
        and public.organization_actor_access(m.organization_id,p_actor,p_player,p_edit)
        and (not p_edit or p_actor=p_player or public.organization_guardian_allowed(p_actor,p_player,m.organization_id,true))
    ));
$$;
create function public.player_history_access(p_owner uuid,p_player uuid,p_actor uuid,p_edit boolean default false)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select case when p_owner is null then public.personal_player_access(p_player,p_actor,p_edit)
    else public.organization_view_scope(p_owner) and public.organization_actor_access(p_owner,p_actor,p_player,p_edit)
      and public.organization_actor_legal_ready(p_owner,p_actor) end;
$$;
revoke all on function public.personal_player_access(uuid,uuid,boolean),public.player_history_access(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.personal_player_access(uuid,uuid,boolean),public.player_history_access(uuid,uuid,uuid,boolean) to authenticated,service_role;

create or replace function public.organization_sports_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare owner uuid; previous_owner uuid; linked uuid; begin
  if tg_table_name in ('training_sessions','golf_rounds') then owner:=new.club_id; else owner:=new.organization_id; end if;
  if tg_op='UPDATE' then
    if new.user_id is distinct from old.user_id then raise exception 'Sports player is immutable' using errcode='42501'; end if;
    if tg_table_name in ('training_sessions','golf_rounds') then previous_owner:=old.club_id; else previous_owner:=old.organization_id; end if;
    if owner is distinct from previous_owner then raise exception 'Sports organization is immutable' using errcode='42501'; end if;
  end if;
  if tg_table_name='training_sessions' then
    if new.club_event_id is not null then
      select club_id into linked from public.club_events where id=new.club_event_id;
      if linked is null or (owner is not null and owner<>linked) then raise exception 'Sports event ownership mismatch' using errcode='42501'; end if;
      if tg_op='UPDATE' and linked is distinct from previous_owner then raise exception 'Sports organization is immutable' using errcode='42501'; end if;
      owner:=linked;
    end if;
    if new.session_type='club' and owner is null then raise exception 'Club training organization required' using errcode='42501'; end if;
  end if;
  if owner is not null and not exists(select 1 from public.organization_members where organization_id=owner and user_id=new.user_id and role='player' and is_active)
    then raise exception 'Sports player outside organization' using errcode='42501'; end if;
  if auth.role()='authenticated' and not public.player_history_access(owner,new.user_id,auth.uid(),true)
    then raise exception 'Sports access forbidden' using errcode='42501'; end if;
  if tg_table_name in ('training_sessions','golf_rounds') then new.club_id:=owner; else new.organization_id:=owner; end if;
  return new;
end $$;

-- Retain the compatibility column for old server clients, without club ownership.
drop trigger organization_validation_owner on public.player_validation_attempts;
insert into public.organization_migration_baseline(object_key,definition)
select 'validation_owners_before_personal_history',coalesce(jsonb_object_agg(id,organization_id),'{}'::jsonb)::text from public.player_validation_attempts;
update public.player_validation_attempts set organization_id=null where organization_id is not null;
comment on column public.player_validation_attempts.organization_id is 'Deprecated compatibility column. Validation attempts and progression belong to player_id.';
create or replace function public.organization_validation_owner() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if new.organization_id is not null then raise exception 'Validation progress has no organization owner' using errcode='42501'; end if;
  if tg_op='UPDATE' and (new.player_id is distinct from old.player_id or new.exercise_id is distinct from old.exercise_id
    or new.created_by_user_id is distinct from old.created_by_user_id) then raise exception 'Validation identity is immutable' using errcode='42501'; end if;
  if auth.role()='authenticated' and ((tg_op='INSERT' and new.created_by_user_id is distinct from auth.uid())
    or not public.personal_player_access(new.player_id,auth.uid(),true)) then raise exception 'Validation access forbidden' using errcode='42501'; end if;
  return new;
end $$;
create trigger organization_validation_owner before insert or update on public.player_validation_attempts
for each row execute function public.organization_validation_owner();

-- Replace only organization restrictions on these player-owned business tables.
do $$ declare tbl text; owner text; subject text; begin
  foreach tbl in array array['training_sessions','golf_rounds','player_activity_events','player_camps','player_validation_attempts'] loop
    owner:=case when tbl in ('training_sessions','golf_rounds') then 'club_id' else 'organization_id' end;
    subject:=case when tbl='player_validation_attempts' then 'player_id' else 'user_id' end;
    execute format('drop policy if exists organization_scope_guard on public.%I',tbl);
    execute format('drop policy if exists organization_view_scope on public.%I',tbl);
    execute format('create policy organization_scope_guard on public.%I as restrictive for all to authenticated using(public.%s(%s,auth.uid())) with check(public.%s(%s,auth.uid(),true))',
      tbl,case when tbl='player_validation_attempts' then 'personal_player_access' else 'player_history_access' end,
      case when tbl='player_validation_attempts' then subject else owner||','||subject end,
      case when tbl='player_validation_attempts' then 'personal_player_access' else 'player_history_access' end,
      case when tbl='player_validation_attempts' then subject else owner||','||subject end);
    execute format('create policy organization_personal_history on public.%I for all to authenticated using(%I is null and public.personal_player_access(%I,auth.uid())) with check(%I is null and public.personal_player_access(%I,auth.uid(),true))',tbl,owner,subject,owner,subject);
  end loop;
end $$;

-- OM scoring is independent from ownership. The history guard above checks
-- the actor's current platform/context documents for personal records.
alter policy legal_required_direct_access on public.golf_rounds
using (club_id is null or public.legal_required_direct_access(club_id))
with check (club_id is null or public.legal_required_direct_access(club_id));

-- Child records inherit either the organization or the personal player owner.
drop policy organization_parent_session_id on public.training_session_items;
create policy organization_parent_session_id on public.training_session_items as restrictive for all to authenticated
using(exists(select 1 from public.training_sessions s where s.id=session_id and public.player_history_access(s.club_id,s.user_id,auth.uid())))
with check(exists(select 1 from public.training_sessions s where s.id=session_id and public.player_history_access(s.club_id,s.user_id,auth.uid(),true)));
drop policy organization_parent_round_id on public.golf_round_holes;
create policy organization_parent_round_id on public.golf_round_holes as restrictive for all to authenticated
using(exists(select 1 from public.golf_rounds r where r.id=round_id and public.player_history_access(r.club_id,r.user_id,auth.uid())))
with check(exists(select 1 from public.golf_rounds r where r.id=round_id and public.player_history_access(r.club_id,r.user_id,auth.uid(),true)));
drop policy organization_parent_camp_id on public.player_camp_days;
create policy organization_parent_camp_id on public.player_camp_days as restrictive for all to authenticated
using(exists(select 1 from public.player_camps c where c.id=camp_id and public.player_history_access(c.organization_id,c.user_id,auth.uid())))
with check(exists(select 1 from public.player_camps c where c.id=camp_id and public.player_history_access(c.organization_id,c.user_id,auth.uid(),true)));
create policy organization_personal_history on public.training_session_items for all to authenticated
using(exists(select 1 from public.training_sessions s where s.id=session_id and s.club_id is null and public.personal_player_access(s.user_id,auth.uid())))
with check(exists(select 1 from public.training_sessions s where s.id=session_id and s.club_id is null and public.personal_player_access(s.user_id,auth.uid(),true)));
create policy organization_personal_history on public.golf_round_holes for all to authenticated
using(exists(select 1 from public.golf_rounds r where r.id=round_id and r.club_id is null and public.personal_player_access(r.user_id,auth.uid())))
with check(exists(select 1 from public.golf_rounds r where r.id=round_id and r.club_id is null and public.personal_player_access(r.user_id,auth.uid(),true)));
create policy organization_personal_history on public.player_camp_days for all to authenticated
using(exists(select 1 from public.player_camps c where c.id=camp_id and c.organization_id is null and public.personal_player_access(c.user_id,auth.uid())))
with check(exists(select 1 from public.player_camps c where c.id=camp_id and c.organization_id is null and public.personal_player_access(c.user_id,auth.uid(),true)));

-- Keep the immutability and event/organization guards in the existing trigger.
do $$ declare definition text; original text; begin
  original:=pg_get_functiondef('public.organization_sports_child_write()'::regprocedure);
  definition:=replace(original,
    'if owner is null then raise exception ''Organization owner required'' using errcode=''42501''; end if;',
    'if owner is null and (subject is null or tg_table_name not in (''training_session_items'',''golf_round_holes'',''player_camp_days'',''training_sessions'',''golf_rounds'',''player_activity_events'',''player_camps'',''player_validation_attempts'')) then raise exception ''Organization owner required'' using errcode=''42501''; end if;');
  definition:=replace(definition,'if auth.role()=''authenticated'' and (not (public.organization_actor_access',
    'if auth.role()=''authenticated'' and owner is null and not public.personal_player_access(subject,auth.uid(),true) then raise exception ''Personal history editing forbidden'' using errcode=''42501''; end if; if auth.role()=''authenticated'' and owner is not null and (not (public.organization_actor_access');
  if definition=original or position('Personal history editing forbidden' in definition)=0 or position('subject is null or tg_table_name not in' in definition)=0 then raise exception 'Personal child guard adaptation failed'; end if;
  execute definition;
end $$;

-- Transactional golf wrappers authorize the actual record, including personal
-- rounds, without interpreting the OM scoring organization as its owner.
create or replace function public.create_player_golf_rounds_transactional(p_player_id uuid,p_round_payload jsonb,p_round_dates timestamptz[],p_holes jsonb default '[]'::jsonb)
returns uuid[] language plpgsql security definer set search_path=public,pg_temp as $$ begin
  if not public.player_history_access(nullif(p_round_payload->>'club_id','')::uuid,p_player_id,auth.uid(),true)
    then raise exception 'Forbidden personal golf round' using errcode='42501'; end if;
  return public.create_player_golf_rounds_transactional_business(p_player_id,p_round_payload,p_round_dates,p_holes);
end $$;
create or replace function public.save_player_golf_hole_transactional(p_round_id uuid,p_hole jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.golf_rounds%rowtype; begin
  select * into r from public.golf_rounds where id=p_round_id;
  if not found or not public.player_history_access(r.club_id,r.user_id,auth.uid(),true) then raise exception 'Forbidden golf round' using errcode='42501'; end if;
  return public.save_player_golf_hole_transactional_business(p_round_id,p_hole);
end $$;
create or replace function public.save_player_golf_holes_transactional(p_round_id uuid,p_holes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.golf_rounds%rowtype; begin
  select * into r from public.golf_rounds where id=p_round_id;
  if not found or not public.player_history_access(r.club_id,r.user_id,auth.uid(),true) then raise exception 'Forbidden golf round' using errcode='42501'; end if;
  return public.save_player_golf_holes_transactional_business(p_round_id,p_holes);
end $$;
create or replace function public.update_player_golf_round_transactional(p_round_id uuid,p_start_at timestamptz,p_notes text,p_competition_level text,p_rounds_18_count smallint,p_tee_name text,p_slope_rating integer,p_course_rating numeric,p_target_hole_count integer,p_holes jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.golf_rounds%rowtype; begin
  select * into r from public.golf_rounds where id=p_round_id;
  if not found or not public.player_history_access(r.club_id,r.user_id,auth.uid(),true) then raise exception 'Forbidden golf round' using errcode='42501'; end if;
  return public.update_player_golf_round_transactional_business(p_round_id,p_start_at,p_notes,p_competition_level,p_rounds_18_count,p_tee_name,p_slope_rating,p_course_rating,p_target_hole_count,p_holes);
end $$;

-- Prepare clear wording for shared personal history. Published documents and
-- immutable presentations/decisions are never rewritten or republished.
create function public.organization_personal_history_notice(p_locale text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select case p_locale
 when 'fr' then 'Historique personnel — Les parcours personnels, activités individuelles et tentatives de validation suivent le joueur dans son compte unique. Les organisations auxquelles il est affilié de manière active et autorisée peuvent consulter cet historique par leurs responsables et les coaches affectés au joueur. Les droits du parent sont vérifiés dans le contexte sélectionné. Les données organisées par un club ou une académie, ainsi que leurs notes privées, restent limitées à leur organisation. Une affiliation en attente, suspendue ou terminée ne permet pas cet accès.'
 when 'en' then 'Personal history — Personal rounds, individual activities and validation attempts follow the player in their single account. Organizations with an active, authorized affiliation may read this history through their managers and coaches assigned to the player. Parent rights are checked in the selected context. Data from activities organized by a club or academy, and their private notes, remain limited to that organization. A pending, suspended or ended affiliation does not grant this access.'
 when 'de' then 'Persönliche Historie — Persönliche Golfrunden, individuelle Aktivitäten und Validierungsversuche bleiben im einzigen Konto des Spielers erhalten. Organisationen mit einer aktiven und genehmigten Zugehörigkeit können diese Historie über ihre Verantwortlichen und dem Spieler zugeteilte Coaches einsehen. Elternrechte werden im ausgewählten Kontext geprüft. Daten aus Aktivitäten eines Clubs oder einer Akademie sowie private Notizen bleiben auf die jeweilige Organisation beschränkt. Eine ausstehende, ausgesetzte oder beendete Zugehörigkeit gewährt keinen solchen Zugang.'
 when 'it' then 'Cronologia personale — Giri personali, attività individuali e tentativi di validazione seguono il giocatore nel suo unico account. Le organizzazioni con un’affiliazione attiva e autorizzata possono consultare questa cronologia tramite i responsabili e i coach assegnati al giocatore. I diritti del genitore sono verificati nel contesto selezionato. I dati delle attività organizzate da un club o un’accademia e le note private restano limitati alla rispettiva organizzazione. Un’affiliazione in attesa, sospesa o terminata non concede tale accesso.'
 end;
$$;
revoke all on function public.organization_personal_history_notice(text) from public,anon,authenticated;
update public.legal_organization_templates template set translations=(select jsonb_object_agg(locale,translation||jsonb_build_object(
 'body',(translation->>'body')||E'\n\n'||public.organization_personal_history_notice(locale),'status','needs_review',
 'source_revision',coalesce((translation->>'source_revision')::integer,0)+1)) from jsonb_each(template.translations) t(locale,translation));
update public.legal_drafts dr set source_revision=dr.source_revision+1,
 change_summary='Active authorized affiliations and personal player history: review all four languages before publication.',
 translations=(select jsonb_object_agg(locale,translation||jsonb_build_object('status','needs_review','source_revision',dr.source_revision+1,
 'body',replace(replace(replace(replace(translation->>'body',
 'Les notes privées, messages, évaluations et dossiers sportifs conservent leur organisation propriétaire.',
 'Les notes privées, messages et évaluations d’organisation conservent leur organisation propriétaire.'),
 'Private notes, messages, evaluations and sports records retain their owning organization.',
 'Organization private notes, messages and evaluations retain their owning organization.'),
 'Private Notizen, Nachrichten, Bewertungen und Sportdaten behalten ihre zuständige Organisation.',
 'Private Notizen, Nachrichten und Bewertungen der Organisation behalten ihre zuständige Organisation.'),
 'Note private, messaggi, valutazioni e dati sportivi mantengono la propria organizzazione.',
 'Note private, messaggi e valutazioni dell’organizzazione mantengono la propria organizzazione.')||E'\n\n'||public.organization_personal_history_notice(locale)))
 from jsonb_each(dr.translations) t(locale,translation)),updated_at=now()
 from public.legal_documents d where d.id=dr.document_id and d.kind='privacy' and d.scope='platform';
insert into public.organization_migration_baseline(object_key,definition)
select 'privacy_prepared:'||dr.document_id,to_jsonb(dr)::text from public.legal_drafts dr
join public.legal_documents d on d.id=dr.document_id where d.kind='privacy' and d.scope='platform'
on conflict(object_key) do update set definition=excluded.definition;

-- Refresh the maintenance rollback checkpoint after the forward correction.
do $$ declare t record; fingerprint text; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname<>'organization_migration_baseline' loop
    execute format('select md5(coalesce(string_agg(to_jsonb(r)::text,'''' order by to_jsonb(r)::text),'''')) from public.%I r',t.relname) into fingerprint;
    insert into public.organization_migration_baseline(object_key,definition) values('prepared_table:'||t.relname,fingerprint)
      on conflict(object_key) do update set definition=excluded.definition;
  end loop;
end $$;
notify pgrst,'reload schema';

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

do $$ declare before_value jsonb;after_value jsonb;begin select fingerprints into before_value from zurich_release_before; select jsonb_object_agg(name,digest) into after_value from (select 'public.rules_series' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_series r),'[]')) digest union all select 'public.rules_cards' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_cards r),'[]')) digest union all select 'public.rules_questions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.rules_questions r),'[]')) digest union all select 'public.etiquette_themes' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.etiquette_themes r),'[]')) digest union all select 'public.etiquette_cards' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.etiquette_cards r),'[]')) digest union all select 'public.validation_sections' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.validation_sections r),'[]')) digest union all select 'public.validation_exercises' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.validation_exercises r),'[]')) digest union all select 'public.training_volume_default_targets' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.training_volume_default_targets r),'[]')) digest union all select 'public.legal_club_templates' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_club_templates r),'[]')) digest union all select 'public.legal_versions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_versions r),'[]')) digest union all select 'public.legal_presentations' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_presentations r),'[]')) digest union all select 'public.legal_decisions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_decisions r),'[]')) digest union all select 'public.legal_activation_events' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_activation_events r),'[]')) digest union all select 'public.legal_representative_assertions' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_representative_assertions r),'[]')) digest union all select 'public.legal_representative_events' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.legal_representative_events r),'[]')) digest union all select 'auth.users' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from auth.users r),'[]')) digest union all select 'public.profiles' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.profiles r),'[]')) digest union all select 'public.app_admins' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from public.app_admins r),'[]')) digest union all select 'storage.objects' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from storage.objects r),'[]')) digest union all select 'storage.buckets' name,md5(coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)::text from storage.buckets r),'[]')) digest) records;if before_value is distinct from after_value then raise exception 'Accounts, legal evidence, reference catalogs or Storage changed: rollback';end if;end $$;

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
    or exists(select 1 from public.training_sessions s left join public.club_events e on e.id=s.club_event_id
      where (s.session_type='club' and s.club_id is null) or
        (s.club_event_id is not null and (e.id is null or s.club_id is distinct from e.club_id)))
    or exists(select 1 from public.player_validation_attempts where organization_id is not null) then
    raise exception 'Organization postflight failed; transaction must be rolled back';
  end if;
end $$;
select 'nonclub_clubs' as check_name,count(*) as violations from public.clubs c join public.organizations o on o.id=c.id where o.org_type<>'club'
union all select 'legacy_club_foreign_keys',count(*) from pg_constraint where contype='f' and confrelid='public.clubs'::regclass
union all select 'projection_mismatches',count(*) from public.organization_members m full join public.club_members c
  on c.club_id=m.organization_id and c.user_id=m.user_id and c.role::text=m.role
  where coalesce(m.role,c.role::text) in ('manager','coach','player','parent') and
    (m.organization_id is null or c.id is null or m.is_active is distinct from coalesce(c.is_active,false)
      or m.player_consent_status is distinct from c.player_consent_status)
union all select 'active_rosters_without_authorization',count(*) from public.academy_roster_entries r
  where r.status='active' and not public.organization_player_authorized(r.academy_id,r.player_id)
union all select 'guardian_scopes_without_family_identity',count(*) from public.player_guardian_scopes s
  left join public.player_guardians g on g.player_id=s.player_id and g.guardian_user_id=s.guardian_user_id where g.player_id is null;
select 'versions' as evidence,count(*) as rows,encode(extensions.digest(coalesce(string_agg(id::text||content_sha256,'' order by id),''),'sha256'),'hex') as fingerprint from public.legal_versions
union all select 'presentations',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_presentations
union all select 'decisions',count(*),encode(extensions.digest(coalesce(string_agg(id::text||rendered_sha256,'' order by id),''),'sha256'),'hex') from public.legal_decisions;
select 'personal_trainings' as history_type,count(*) as records from public.training_sessions where club_id is null
union all select 'personal_rounds',count(*) from public.golf_rounds where club_id is null
union all select 'personal_activities',count(*) from public.player_activity_events where organization_id is null
union all select 'personal_camps',count(*) from public.player_camps where organization_id is null
union all select 'player_validations',count(*) from public.player_validation_attempts where organization_id is null;
select count(*) as organization_templates from public.legal_organization_templates;
select count(*) as ftem_defaults from public.training_volume_default_targets;
select count(*) as organizations from public.organizations;
select role,count(*) from public.organization_members group by role order by role;
select count(*) as nonadmin_profiles from public.profiles p where not exists(select 1 from public.app_admins a where a.user_id=p.id);

select 'Zurich personal-history correction verified; clubs=0; organizations=0; only existing superadmin; protected fingerprints unchanged' as release_result;
commit;
