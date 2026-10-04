-- One coherent campaign repair batch; NOT APPLIED by the campaign.
-- Target TEST wizbeuuvjibmmuxyynly. Review 24 preflight and 25 postflight.
-- No activation, publication, backfill, real-user write, or retention change.
begin;
do $$ begin
 if (select enabled from public.legal_enforcement_control where singleton) is distinct from false then
   raise exception 'Legal enforcement must remain disabled'; end if;
 if to_regprocedure('extensions.digest(text,text)') is null then raise exception 'Expected pgcrypto in extensions'; end if;
end $$;

CREATE OR REPLACE FUNCTION public.publish_legal_draft(p_document_id uuid, p_publisher uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.legal_documents%rowtype; dr public.legal_drafts%rowtype; loc text; tr jsonb; n integer; v uuid; snap jsonb;
  source_variables text[]; translated_variables text[];
begin
  select * into d from public.legal_documents where id=p_document_id for update;
  if not found then raise exception 'Document missing'; end if;
  select * into dr from public.legal_drafts where document_id=p_document_id for update;
  if not found or length(trim(dr.change_summary))=0 then raise exception 'Change summary required'; end if;
  if d.applicability->>'status'<>'approved' or not exists(select 1 from public.legal_rule_revisions rr where rr.document_id=d.id
    and rr.configuration=d.applicability and rr.reviewed_by is not null and rr.reviewed_at is not null
    and rr.revision=(select max(revision) from public.legal_rule_revisions where document_id=d.id)) then raise exception 'Applicability unapproved'; end if;
  if exists(select 1 from unnest(dr.allowed_variables) as t(variable)
    where variable not in ('child_name','club_name','user_name')) then raise exception 'Unsupported variable'; end if;
  if not ('fr'=any(d.required_locales)) then raise exception 'French source required'; end if;
  source_variables:=public.legal_template_variables(
    coalesce(dr.translations->'fr'->>'title','')||coalesce(dr.translations->'fr'->>'body','')||coalesce(dr.translations->'fr'->>'action_label',''));
  foreach loc in array d.required_locales loop
    tr:=dr.translations->loc;
    if loc not in ('fr','en','de','it') or tr is null or tr->>'status'<>'approved'
       or coalesce((tr->>'source_revision')::integer,-1)<>dr.source_revision
       or length(trim(coalesce(tr->>'title','')))=0 or length(trim(coalesce(tr->>'body','')))=0
       or (d.action_kind<>'read' and length(trim(coalesce(tr->>'action_label','')))=0)
    then raise exception 'Missing or unapproved translation: %',loc; end if;
    if not public.legal_template_is_valid(coalesce(tr->>'title',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'body',''),dr.allowed_variables)
      or not public.legal_template_is_valid(coalesce(tr->>'action_label',''),dr.allowed_variables)
    then raise exception 'Invalid placeholder: %',loc; end if;
    translated_variables:=public.legal_template_variables(coalesce(tr->>'title','')||coalesce(tr->>'body','')||coalesce(tr->>'action_label',''));
    if translated_variables<>source_variables then raise exception 'Placeholder mismatch: %',loc; end if;
  end loop;
  select coalesce(max(version_number),0)+1 into n from public.legal_versions where document_id=d.id;
  snap:=jsonb_build_object('document_key',d.document_key,'kind',d.kind,'purpose_key',d.purpose_key,
    'scope',d.scope,'club_id',d.club_id,'audience_roles',d.audience_roles,'action_kind',d.action_kind,
    'required',d.required,'applicability',d.applicability,'required_locales',d.required_locales,
    'allowed_variables',dr.allowed_variables,'translations',dr.translations,'change_summary',dr.change_summary);
  insert into public.legal_versions(document_id,version_number,snapshot,content_sha256,published_by)
  values(d.id,n,snap,encode(extensions.digest(snap::text,'sha256'),'hex'),p_publisher) returning id into v;
  return v;
end $function$
;
CREATE OR REPLACE FUNCTION public.present_legal_document(p_document uuid, p_actor uuid, p_beneficiary uuid, p_role text, p_locale text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare d public.legal_documents%rowtype; v public.legal_versions%rowtype; tr jsonb; rendered jsonb; presentation uuid;
  variable text; value text; rendered_title text; rendered_body text; rendered_action text; allowed text[];
begin
  select * into d from public.legal_documents where id=p_document for update;
  if not found or not d.active then raise exception 'Document unavailable'; end if;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not (p_role=any(d.audience_roles)) or not public.legal_actor_allowed(p_actor,p_beneficiary,d.club_id,p_role) then raise exception 'Forbidden'; end if;
  if d.kind='parent_authorization' and p_actor=p_beneficiary then raise exception 'Child beneficiary required'; end if;
  if p_actor<>p_beneficiary and d.kind<>'parent_authorization' and d.kind<>'specific_consent' then raise exception 'Wrong beneficiary'; end if;
  select * into v from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if not found then raise exception 'No published version'; end if;
  if public.legal_version_matches_document(d.id,v.id) is not true then raise exception 'Published metadata changed'; end if;
  tr:=v.snapshot->'translations'->p_locale;
  if tr is null or tr->>'status'<>'approved' then raise exception 'Locale unavailable'; end if;
  rendered_title:=tr->>'title'; rendered_body:=tr->>'body'; rendered_action:=tr->>'action_label';
  allowed:=array(select jsonb_array_elements_text(v.snapshot->'allowed_variables'));
  if not public.legal_template_is_valid(coalesce(rendered_title,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_body,''),allowed)
    or not public.legal_template_is_valid(coalesce(rendered_action,''),allowed)
  then raise exception 'Published template invalid'; end if;
  foreach variable in array array['child_name','club_name','user_name'] loop
    if variable=any(public.legal_template_variables(rendered_title||rendered_body||coalesce(rendered_action,''))) then
      case variable
        when 'child_name' then
          if p_actor=p_beneficiary then raise exception 'Child variable requires a child beneficiary'; end if;
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_beneficiary;
        when 'club_name' then
          if d.club_id is null then raise exception 'Club variable requires a club document'; end if;
          select nullif(btrim(name),'') into value from public.clubs where id=d.club_id;
        when 'user_name' then
          select nullif(btrim(concat_ws(' ',first_name,last_name)),'') into value from public.profiles where id=p_actor;
      end case;
      if value is null or position('{{' in value)>0 or position('}}' in value)>0 then raise exception 'Template value unavailable'; end if;
      rendered_title:=replace(rendered_title,'{{'||variable||'}}',value);
      rendered_body:=replace(rendered_body,'{{'||variable||'}}',value);
      rendered_action:=replace(rendered_action,'{{'||variable||'}}',value);
    end if;
  end loop;
  rendered:=jsonb_build_object('document_id',d.id,'version_id',v.id,'version_number',v.version_number,
    'kind',d.kind,'purpose_key',d.purpose_key,'scope',d.scope,'club_id',d.club_id,'action_kind',d.action_kind,
    'locale',p_locale,'title',rendered_title,'body',rendered_body,'action_label',rendered_action,
    'notice_version_ids','[]'::jsonb);
  insert into public.legal_presentations(actor_id,beneficiary_id,actor_role,authority,document_id,version_id,club_id,locale,rendered_snapshot,rendered_sha256)
  values(p_actor,p_beneficiary,p_role,case when p_actor=p_beneficiary then 'self' else 'verified_representative' end,
    d.id,v.id,d.club_id,p_locale,rendered,encode(extensions.digest(rendered::text,'sha256'),'hex')) returning id into presentation;
  return presentation;
end $function$
;
CREATE OR REPLACE FUNCTION public.decide_legal_document(p_presentation uuid, p_actor uuid, p_decision text, p_key uuid, p_parent_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; previous public.legal_current_state%rowtype;
  challenge public.legal_parent_challenges%rowtype; event_id uuid; expected text;
begin
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if not exists(select 1 from public.legal_decisions where id=event_id and presentation_id=p_presentation and decision=p_decision) then
      raise exception 'Idempotency key reused for another decision';
    end if;
    return event_id;
  end if;
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.expires_at<now() then raise exception 'Presentation expired or forbidden'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if coalesce(d.applicability->>'rule','')<>'all_members' then raise exception 'Rule engine not configured'; end if;
  if not d.active or not public.legal_actor_allowed(p_actor,p.beneficiary_id,p.club_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into event_id from public.legal_decisions where actor_id=p_actor and idempotency_key=p_key;
  if found then
    if not exists(select 1 from public.legal_decisions where id=event_id and presentation_id=p_presentation and decision=p_decision) then
      raise exception 'Idempotency key reused for another decision';
    end if;
    return event_id;
  end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest is distinct from p.version_id then raise exception 'Legal version changed'; end if;
  if public.legal_version_matches_document(d.id,p.version_id) is not true then raise exception 'Published metadata changed'; end if;
  if p.rendered_sha256<>encode(extensions.digest(p.rendered_snapshot::text,'sha256'),'hex') then raise exception 'Presentation integrity failed'; end if;
  if p_decision not in ('accepted','acknowledged','authorized','consented','refused','withdrawn') then raise exception 'Invalid decision'; end if;
  if p_decision='withdrawn' and d.kind<>'specific_consent' then raise exception 'Not withdrawable here'; end if;
  if p_decision='accepted' and d.action_kind<>'accept' or p_decision='acknowledged' and d.action_kind not in ('acknowledge','read')
     or p_decision='authorized' and d.action_kind<>'authorize' or p_decision='consented' and d.action_kind<>'consent'
  then raise exception 'Wrong action'; end if;
  if p.actor_id<>p.beneficiary_id and p_decision not in ('refused','withdrawn') then
    select * into challenge from public.legal_parent_challenges where presentation_id=p.id and actor_id=p_actor
      order by created_at desc limit 1 for update;
    if not found or challenge.used_at is not null or challenge.expires_at<now() or challenge.attempts>=5 then raise exception 'Confirmation required'; end if;
    update public.legal_parent_challenges set attempts=attempts+1 where id=challenge.id;
    expected:=encode(extensions.digest(coalesce(p_parent_code,''),'sha256'),'hex');
    if expected<>challenge.secret_hash then return null; end if;
    if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(extensions.digest(lower(trim(u.email)),'sha256'),'hex')=challenge.email_hash) then raise exception 'Parent email changed'; end if;
    update public.legal_parent_challenges set used_at=now() where id=challenge.id;
    challenge.used_at:=now();
  end if;
  select * into previous from public.legal_current_state where document_id=d.id and beneficiary_id=p.beneficiary_id
    and scope_key=coalesce(p.club_id::text,'platform') for update;
  if found and previous.conflict and p_decision in ('accepted','authorized','consented') then raise exception 'Withdrawal conflict requires review'; end if;
  insert into public.legal_decisions(presentation_id,actor_id,beneficiary_id,document_id,version_id,club_id,
    decision,rendered_snapshot,rendered_sha256,authority_snapshot,idempotency_key)
  values(p.id,p_actor,p.beneficiary_id,d.id,p.version_id,p.club_id,p_decision,p.rendered_snapshot,p.rendered_sha256,
    jsonb_build_object('role',p.actor_role,'authority',p.authority,'parent_email_confirmed',challenge.used_at is not null),p_key)
  returning id into event_id;
  insert into public.legal_current_state(document_id,beneficiary_id,club_scope,version_id,decision_id,decision,decided_at,conflict)
  values(d.id,p.beneficiary_id,p.club_id,p.version_id,event_id,p_decision,now(),p_decision='withdrawn')
  on conflict(document_id,beneficiary_id,scope_key) do update set version_id=excluded.version_id,decision_id=excluded.decision_id,
    decision=excluded.decision,decided_at=excluded.decided_at,
    conflict=case when excluded.decision='withdrawn' then true else legal_current_state.conflict end;
  return event_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.issue_legal_parent_challenge(p_presentation uuid, p_actor uuid, p_email_hash text, p_secret_hash text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.legal_presentations%rowtype; d public.legal_documents%rowtype; latest uuid; recent timestamptz; sends integer; challenge_id uuid;
begin
  if p_email_hash !~ '^[0-9a-f]{64}$' or p_secret_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid challenge'; end if;
  perform pg_advisory_xact_lock(hashtextextended('legal_parent:'||p_actor::text,0));
  select * into p from public.legal_presentations where id=p_presentation;
  if not found or p.actor_id<>p_actor or p.beneficiary_id=p_actor or p.expires_at<=now()
    or p.authority<>'verified_representative' then raise exception 'Presentation unavailable'; end if;
  select * into d from public.legal_documents where id=p.document_id for update;
  if not d.active or not public.legal_actor_allowed(p_actor,p.beneficiary_id,p.club_id,p.actor_role) then raise exception 'Access changed'; end if;
  select id into latest from public.legal_versions where document_id=d.id order by version_number desc limit 1;
  if latest is distinct from p.version_id then raise exception 'Legal version changed'; end if;
  if not exists(select 1 from auth.users u where u.id=p_actor and u.email_confirmed_at is not null
      and encode(extensions.digest(lower(trim(u.email)),'sha256'),'hex')=p_email_hash) then raise exception 'Verified parent email required'; end if;
  select max(created_at),count(*) filter(where created_at>now()-interval '1 hour') into recent,sends
    from public.legal_parent_challenges where actor_id=p_actor;
  if recent>now()-interval '1 minute' or sends>=5 then raise exception 'Challenge rate limited'; end if;
  update public.legal_parent_challenges set used_at=now() where presentation_id=p.id and used_at is null;
  insert into public.legal_parent_challenges(presentation_id,actor_id,beneficiary_id,email_hash,secret_hash,expires_at)
  values(p.id,p_actor,p.beneficiary_id,p_email_hash,p_secret_hash,least(p.expires_at,now()+interval '10 minutes'))
  returning id into challenge_id;
  return challenge_id;
end $function$
;
-- These entry points are only called by server routes and SECURITY DEFINER
-- triggers in the current repository. Client JWTs must not call them directly.
-- Nested triggers keep postgres ownership; no business body changes.
revoke all on function public.pick_event_thread_actor_user_id(uuid) from public,anon,authenticated;
grant execute on function public.pick_event_thread_actor_user_id(uuid) to service_role;
revoke all on function public.recompute_golf_round_stats(uuid) from public,anon,authenticated;
revoke all on function public.sync_org_player_performance_from_groups(uuid) from public,anon,authenticated;
revoke all on function public.ensure_event_thread_for_event(uuid) from public,anon,authenticated;
revoke all on function public.sync_event_thread_participants(uuid) from public,anon,authenticated;
grant execute on function public.recompute_golf_round_stats(uuid),public.sync_org_player_performance_from_groups(uuid),
 public.ensure_event_thread_for_event(uuid),public.sync_event_thread_participants(uuid) to service_role;

-- Marketplace API is club-scoped; legacy permissive policies exposed active
-- rows to anonymous callers and every club. Existing ownership/guardian rules
-- still decide each action. This restrictive policy adds the club boundary.
create policy marketplace_club_boundary on public.marketplace_items as restrictive
for all to anon,authenticated
using (
 auth.uid() is not null and (
  exists(select 1 from public.club_members m where m.club_id=marketplace_items.club_id and m.user_id=auth.uid() and m.is_active)
  or exists(select 1 from public.player_guardians g join public.club_members m on m.user_id=g.player_id
   where g.guardian_user_id=auth.uid() and g.player_id=marketplace_items.user_id and coalesce(g.can_view,false)
   and m.club_id=marketplace_items.club_id and m.role='player' and m.is_active)
 ))
with check (
 auth.uid() is not null and (
  exists(select 1 from public.club_members m where m.club_id=marketplace_items.club_id and m.user_id=auth.uid() and m.is_active)
  or exists(select 1 from public.player_guardians g join public.club_members m on m.user_id=g.player_id
   where g.guardian_user_id=auth.uid() and g.player_id=marketplace_items.user_id and coalesce(g.can_edit,false)
   and m.club_id=marketplace_items.club_id and m.role='player' and m.is_active)
 ));
-- A stale form is a permanent application conflict, not a serialization retry.
-- Supabase/PostgREST can retry 40001 until gateway timeout. Preserve all business
-- checks/messages and map these five reviewed conflicts to HTTP 409 instead.
-- Abort on definition drift rather than rewriting an unseen function.
do $campaign_conflicts$
declare signature text; expected_md5 text; body text; changed text;
begin
 for signature,expected_md5 in select * from (values
  ('public.copy_manager_event_structure_v1_business(uuid,jsonb)','b1d9c574564243bfe0c43a171398bd61'),
  ('public.remove_manager_parent_v1(uuid,uuid,uuid,uuid[],uuid[])','d119f77fa08676993a736654c0ff2a0c'),
  ('public.save_manager_camp_v1(uuid,uuid,uuid,text,jsonb)','17c50b635aa6264aa5ffbc81958d1df6'),
  ('public.update_manager_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])','ba321b37dcc6a30afa1138c06dffddb4'),
  ('public.update_manager_event_series_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)','69509e7a777eb03bca559e4ec7516e78')
 ) as reviewed(signature,definition_md5) loop
  body:=pg_get_functiondef(to_regprocedure(signature));
  if body is null or md5(body)<>expected_md5 then raise exception 'Campaign definition drift: %',signature; end if;
  changed:=replace(replace(body,'errcode=''40001''','errcode=''PT409'''),'errcode = ''40001''','errcode = ''PT409''');
  if changed=body or changed like '%40001%' then raise exception 'Unexpected conflict code: %',signature; end if;
  execute changed;
 end loop;
end $campaign_conflicts$;


-- This validation only: the whole candidate batch and all changes ROLLBACK.
create temporary table qa_results(name text,result text,evidence jsonb) on commit drop;
create function pg_temp.qa_check(p_name text,p_ok boolean,p_proof jsonb default '{}'::jsonb) returns void language plpgsql as $$
begin insert into qa_results values(p_name,case when p_ok then 'PASS' else 'FAIL' end,p_proof); end $$;
create function pg_temp.qa_denied(p_name text,p_sql text) returns void language plpgsql as $$
begin
 execute p_sql;
 insert into qa_results values(p_name,'FAIL','{"unexpected_success":true}');
 exception when others then insert into qa_results values(p_name,'PASS',jsonb_build_object('sqlstate',sqlstate,'error',sqlerrm));
end $$;
create function pg_temp.qa_publish(p_doc uuid) returns uuid language plpgsql as $$
declare expected jsonb;begin
 select jsonb_build_object('document',to_jsonb(d)-'id'-'created_at'-'created_by',
 'draft',jsonb_build_object('source_revision',dr.source_revision,'change_summary',dr.change_summary,'allowed_variables',dr.allowed_variables,'translations',dr.translations),
 'latest_version_id',(select id from public.legal_versions where document_id=d.id order by version_number desc limit 1)) into expected
 from public.legal_documents d join public.legal_drafts dr on dr.document_id=d.id where d.id=p_doc;
 return public.publish_legal_draft_checked(p_doc,'f3a9ef62-4a30-435a-9e24-486b25b793a8'::uuid,expected);end $$;

do $$ declare d uuid;v uuid;v2 uuid;p uuid;q uuid;dec uuid;again uuid;k uuid;record_row record;ch uuid;wrong uuid;loc text;actor uuid;role_name text;current_row public.legal_current_state%rowtype;
begin
 foreach d in array array['26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'fc4d05d7-02ed-4423-8e62-1e0038f40992'::uuid,'d42f078d-458f-4575-adca-eba4552c83b9'::uuid] loop
 v:=pg_temp.qa_publish(d);
 perform pg_temp.qa_check('candidate publication four reviewed languages',v is not null,jsonb_build_object('document',d,'version',v));
 update public.legal_documents set active=true where id=d and club_id='bb40f777-beb3-4180-b7b6-2718c6dc095c'::uuid;
 end loop;
 for record_row in select * from (values ('3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'player','fr'),('73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'parent','en'),('e31feb48-5071-4d56-b3b5-bae425225b04'::uuid,'coach','de'),('3f05bcca-fbb3-4212-8040-8fa66ad7388b'::uuid,'manager','it')) t(actor,role_name,locale) loop
 actor:=record_row.actor;role_name:=record_row.role_name;loc:=record_row.locale;
 p:=public.present_legal_document('26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,actor,actor,role_name,loc);k:=gen_random_uuid();
 dec:=public.decide_legal_document(p,actor,'accepted',k,null);again:=public.decide_legal_document(p,actor,'accepted',k,null);
 perform pg_temp.qa_check('candidate decision and idempotence '||role_name,dec=again and exists(select 1 from public.legal_decisions where id=dec and rendered_snapshot->>'locale'=loc and rendered_snapshot->>'body' not like '%{{%'),jsonb_build_object('decision',dec));
 perform pg_temp.qa_denied('key mismatch '||role_name,format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,actor,'refused',k));
 end loop;
 perform pg_temp.qa_denied('second club presentation',format('select public.present_legal_document(%L,%L,%L,%L,%L)','26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'d5c4021a-2b4d-4f3b-8363-f24bb0465465'::uuid,'d5c4021a-2b4d-4f3b-8363-f24bb0465465'::uuid,'player','fr'));
 perform pg_temp.qa_denied('wrong role presentation',format('select public.present_legal_document(%L,%L,%L,%L,%L)','26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'manager','fr'));
 perform pg_temp.qa_denied('unknown locale',format('select public.present_legal_document(%L,%L,%L,%L,%L)','26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'player','es'));
 perform pg_temp.qa_denied('old publication without preview',format('select public.publish_legal_draft_checked(%L,%L,null)','26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'f3a9ef62-4a30-435a-9e24-486b25b793a8'::uuid));
 perform pg_temp.qa_denied('immutable decisions',format('update public.legal_decisions set decision=%L where id=%L','refused',dec));
 perform pg_temp.qa_denied('immutable presentations',format('delete from public.legal_presentations where id=%L',p));
 p:=public.present_legal_document('26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'player','fr');
 update public.legal_drafts set source_revision=source_revision+1,change_summary='Fixture v2 rollback',translations=(select jsonb_object_agg(key,value||jsonb_build_object('source_revision',source_revision+1,'body',value->>'body'||' FICTIVE V2')) from jsonb_each(translations)) where document_id='26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid;
 v2:=pg_temp.qa_publish('26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid);
 perform pg_temp.qa_denied('stale presentation after version change',format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'accepted',gen_random_uuid()));
 perform pg_temp.qa_check('prior version remains recorded',exists(select 1 from public.legal_current_state where document_id='26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid and beneficiary_id='3738664c-5906-43a1-8d9e-0042950fa82f'::uuid and version_id<>v2));
 p:=public.present_legal_document('26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'player','fr');
 dec:=public.decide_legal_document(p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'refused',gen_random_uuid(),null);
 perform pg_temp.qa_check('refusal persists',exists(select 1 from public.legal_current_state where document_id='26f45674-f30f-4df1-88ac-357b9bbb4ebb'::uuid and beneficiary_id='3738664c-5906-43a1-8d9e-0042950fa82f'::uuid and decision='refused' and version_id=v2));
 p:=public.present_legal_document('fc4d05d7-02ed-4423-8e62-1e0038f40992'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'player','fr');
 perform public.decide_legal_document(p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'consented',gen_random_uuid(),null);
 perform public.decide_legal_document(p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'withdrawn',gen_random_uuid(),null);
 perform pg_temp.qa_denied('withdrawal conflict blocks new consent',format('select public.decide_legal_document(%L,%L,%L,%L,null)',p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'consented',gen_random_uuid()));
 perform public.resolve_legal_withdrawal_conflict('fc4d05d7-02ed-4423-8e62-1e0038f40992'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'bb40f777-beb3-4180-b7b6-2718c6dc095c'::uuid,'f3a9ef62-4a30-435a-9e24-486b25b793a8'::uuid,'Fictional conflict review in rollback transaction');
 perform public.decide_legal_document(p,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'consented',gen_random_uuid(),null);
 perform pg_temp.qa_check('withdrawal history preserved after resolution',exists(select 1 from public.legal_decisions where document_id='fc4d05d7-02ed-4423-8e62-1e0038f40992'::uuid and decision='withdrawn'));
 perform pg_temp.qa_denied('guardian link alone insufficient',format('select public.present_legal_document(%L,%L,%L,%L,%L)','d42f078d-458f-4575-adca-eba4552c83b9'::uuid,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'parent','fr'));
 perform public.review_legal_representative('73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'bb40f777-beb3-4180-b7b6-2718c6dc095c'::uuid,'verified','Fictional assertion only in rollback transaction','f3a9ef62-4a30-435a-9e24-486b25b793a8'::uuid);
 p:=public.present_legal_document('d42f078d-458f-4575-adca-eba4552c83b9'::uuid,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'parent','fr');
 ch:=public.issue_legal_parent_challenge(p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,encode(extensions.digest('legalqa_20261004_673faa.parent@example.invalid','sha256'),'hex'),encode(extensions.digest('135790','sha256'),'hex'));
 wrong:=public.decide_legal_document(p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'authorized',gen_random_uuid(),'000000');
 perform pg_temp.qa_check('wrong code attempt persists',wrong is null and exists(select 1 from public.legal_parent_challenges where id=ch and attempts=1));
 k:=gen_random_uuid();dec:=public.decide_legal_document(p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'authorized',k,'135790');
 perform pg_temp.qa_check('verified parent authority and beneficiary recorded',exists(select 1 from public.legal_decisions where id=dec and beneficiary_id='3738664c-5906-43a1-8d9e-0042950fa82f'::uuid and authority_snapshot->>'parent_email_confirmed'='true'));
 again:=public.decide_legal_document(p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'authorized',k,'135790');perform pg_temp.qa_check('parent idempotence after code consumed',again=dec);
 perform pg_temp.qa_denied('consumed code cannot create second decision',format('select public.decide_legal_document(%L,%L,%L,%L,%L)',p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'authorized',gen_random_uuid(),'135790'));
 perform pg_temp.qa_denied('challenge throttling',format('select public.issue_legal_parent_challenge(%L,%L,%L,%L)',p,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,encode(extensions.digest('legalqa_20261004_673faa.parent@example.invalid','sha256'),'hex'),encode(extensions.digest('246810','sha256'),'hex')));
 perform public.review_legal_representative('73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'bb40f777-beb3-4180-b7b6-2718c6dc095c'::uuid,'revoked','Fictional revocation only in rollback transaction','f3a9ef62-4a30-435a-9e24-486b25b793a8'::uuid);
 perform pg_temp.qa_denied('revoked authority cannot present',format('select public.present_legal_document(%L,%L,%L,%L,%L)','d42f078d-458f-4575-adca-eba4552c83b9'::uuid,'73c32ac7-8852-4b1b-91c3-77d66ba649b9'::uuid,'3738664c-5906-43a1-8d9e-0042950fa82f'::uuid,'parent','fr'));
 perform pg_temp.qa_check('SQL enforcement remains disabled',(select enabled=false from public.legal_enforcement_control where singleton));
end $$;
-- Real PostgreSQL role/claims for RLS and nested-trigger regression.
grant select,insert on qa_results to authenticated,anon;
select set_config('request.jwt.claims','{"sub":"3738664c-5906-43a1-8d9e-0042950fa82f","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.qa_check('Marketplace own club after candidate',(select count(*)>0 from public.marketplace_items where id='c07e980e-18b6-45e3-af85-4d698f08e885'));
select pg_temp.qa_check('golf hole with recompute trigger after candidate',(public.save_player_golf_hole_transactional('39f3d159-b012-4253-9b94-e5842eff3aff','{"hole_no":1,"par":4,"score":6,"putts":2}') ->>'ok')::boolean);
reset role;
select set_config('request.jwt.claims','{"sub":"d5c4021a-2b4d-4f3b-8363-f24bb0465465","role":"authenticated"}',true);
set local role authenticated;
select pg_temp.qa_check('Marketplace second club after candidate',(select count(*)=0 from public.marketplace_items where id='c07e980e-18b6-45e3-af85-4d698f08e885'));
select pg_temp.qa_denied('cross-club event RPC after candidate','select public.ensure_event_thread_for_event(''f89262e5-2589-4fd7-8aa7-183c70b4e8c2'')');
select pg_temp.qa_denied('cross-club sync RPC after candidate','select public.sync_event_thread_participants(''f89262e5-2589-4fd7-8aa7-183c70b4e8c2'')');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
select pg_temp.qa_check('Marketplace anonymous after candidate',(select count(*)=0 from public.marketplace_items where id='c07e980e-18b6-45e3-af85-4d698f08e885'));
select pg_temp.qa_denied('anonymous actor lookup after candidate','select public.pick_event_thread_actor_user_id(''f89262e5-2589-4fd7-8aa7-183c70b4e8c2'')');
select pg_temp.qa_denied('anonymous stats after candidate','select public.recompute_golf_round_stats(''39f3d159-b012-4253-9b94-e5842eff3aff'')');
select pg_temp.qa_denied('anonymous performance sync after candidate','select public.sync_org_player_performance_from_groups(''bb40f777-beb3-4180-b7b6-2718c6dc095c'')');
reset role;
set local role service_role;
update public.club_events set title='JETABLE rollback trigger check' where id='f89262e5-2589-4fd7-8aa7-183c70b4e8c2';
reset role;
select pg_temp.qa_check('event trigger still updates thread after candidate',(select title='JETABLE rollback trigger check' from public.message_threads where id='fa4de12f-a9b9-4380-9860-19263ed6f399'));
select set_config('request.jwt.claims','{"sub":"3f05bcca-fbb3-4212-8040-8fa66ad7388b","role":"authenticated"}',true);
set local role authenticated;
do $$ declare snap jsonb; changed jsonb; begin
 snap:=public.get_manager_planning_snapshot_v1('f89262e5-2589-4fd7-8aa7-183c70b4e8c2');
 changed:=(snap->'event')||'{"location_text":"JETABLE candidate concurrency"}'::jsonb;
 perform public.update_manager_event_occurrence_v1('f89262e5-2589-4fd7-8aa7-183c70b4e8c2',snap,changed,
 array(select jsonb_array_elements_text(snap->'coach_ids')::uuid),array(select jsonb_array_elements_text(snap->'player_ids')::uuid),
 snap->'structure',array(select jsonb_array_elements_text(snap->'criterion_ids')::uuid));
 perform pg_temp.qa_check('candidate Manager occurrence edit persists',(select location_text='JETABLE candidate concurrency' from public.club_events where id='f89262e5-2589-4fd7-8aa7-183c70b4e8c2'));
 begin
  perform public.update_manager_event_occurrence_v1('f89262e5-2589-4fd7-8aa7-183c70b4e8c2',snap,changed,
  array(select jsonb_array_elements_text(snap->'coach_ids')::uuid),array(select jsonb_array_elements_text(snap->'player_ids')::uuid),
  snap->'structure',array(select jsonb_array_elements_text(snap->'criterion_ids')::uuid));
  perform pg_temp.qa_check('candidate stale Manager snapshot returns PT409',false);
 exception when others then perform pg_temp.qa_check('candidate stale Manager snapshot returns PT409',sqlstate='PT409' and sqlerrm='planning_conflict',jsonb_build_object('code',sqlstate,'message',sqlerrm)); end;
end $$;
reset role;
select * from qa_results order by name;
rollback;
