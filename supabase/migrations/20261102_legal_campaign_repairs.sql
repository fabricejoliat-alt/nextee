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

notify pgrst, 'reload schema';
commit;
