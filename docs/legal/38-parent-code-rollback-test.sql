-- TEST only, after 20261108. All identities/documents/decisions are fictional,
-- created in this transaction and removed by ROLLBACK. No email is sent.
begin;
-- The real TEST toggle remains false after this transaction rolls back.
update public.legal_parent_code_control set required=true,updated_at=now() where singleton;
create temporary table parent_authorization_checks(item text,ok boolean) on commit drop;
do $$
declare
  parent_id uuid:=gen_random_uuid(); child_a uuid:=gen_random_uuid(); child_b uuid:=gen_random_uuid();
  admin_id uuid:=gen_random_uuid(); club_a uuid:=gen_random_uuid(); club_b uuid:=gen_random_uuid();
  doc uuid; other_doc uuid; v uuid; p1 uuid; p2 uuid; p3 uuid; p_ai uuid; decision_id uuid; key1 uuid:=gen_random_uuid();
  tr jsonb:='{}'; loc text; failed boolean; count_before integer; run text:='legalqa_parent_'||replace(gen_random_uuid()::text,'-','');
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
  values(parent_id,run||'@example.invalid',now(),'{}'),(child_a,run||'_a@example.invalid',now(),'{}'),
    (child_b,run||'_b@example.invalid',now(),'{}'),(admin_id,run||'_admin@example.invalid',now(),'{}');
  insert into public.profiles(id,first_name,last_name,username,birth_date)
  values(parent_id,'Parent','Fictif',run||'_parent','1980-01-01'),(child_a,'Enfant A','Fictif',run||'_a','2014-01-01'),
    (child_b,'Enfant B','Fictif',run||'_b','2015-01-01'),(admin_id,'Admin','Fictif',run||'_admin','1980-01-01')
  on conflict(id) do update set first_name=excluded.first_name,last_name=excluded.last_name;
  insert into public.app_admins(user_id) values(admin_id);
  insert into public.clubs(id,name,slug) values(club_a,'TEST Club A',run||'_a'),(club_b,'TEST Club B',run||'_b');
  insert into public.organizations(id,name,slug,org_type) values(club_a,'TEST Club A',run||'_a','club'),(club_b,'TEST Club B',run||'_b','club');
  insert into public.club_members(club_id,user_id,role,is_active,player_consent_status)
  values(club_a,parent_id,'parent',true,null),(club_a,child_a,'player',true,'pending'),
    (club_a,child_b,'player',true,'pending'),(club_b,child_a,'player',true,'pending');
  insert into public.player_guardians(player_id,guardian_user_id,relation,can_view,can_edit)
  values(child_a,parent_id,'father',true,true),(child_b,parent_id,'father',true,true);
  doc:=public.create_legal_document(run||'_auth','parent_authorization','service.parent_authorization',
    'club',club_a,array['parent'],'authorize',false,admin_id);
  other_doc:=public.create_legal_document(run||'_ai','specific_consent','coaching.rewrite',
    'club',club_a,array['parent'],'consent',false,admin_id);
  perform public.configure_legal_audience(doc,(select applicability from public.legal_documents where id=doc),admin_id);
  foreach loc in array array['fr','en','de','it'] loop
    tr:=tr||jsonb_build_object(loc,jsonb_build_object('title','TEST '||loc||' {{child_name}} — {{club_name}}',
      'body','DOCUMENT FICTIF sans valeur juridique. {{child_name}} / {{club_name}}.',
      'action_label','Confirmer le test','status','approved','source_revision',1));
  end loop;
  update public.legal_drafts set translations=tr,allowed_variables=array['child_name','club_name'],change_summary='Test fictif'
    where document_id=doc;
  v:=public.publish_legal_draft(doc,admin_id);
  update public.legal_documents set active=true where id=doc;
  insert into parent_authorization_checks values('club_link_allows_parent_document',public.legal_document_actor_allowed(doc,parent_id,child_a,'parent'));
  insert into parent_authorization_checks values('club_link_does_not_verify_ai_representative',not public.legal_document_actor_allowed(other_doc,parent_id,child_a,'parent'));
  foreach loc in array array['fr','en','de','it'] loop
    p1:=public.present_legal_document(doc,parent_id,child_a,'parent',loc);
    insert into parent_authorization_checks select 'child_name_rendered_'||loc,
      rendered_snapshot->>'title' like '%Enfant A Fictif%' and rendered_snapshot->>'body' like '%TEST Club A%'
      and authority='club_linked_parent' from public.legal_presentations where id=p1;
  end loop;
  p1:=public.present_legal_document(doc,parent_id,child_a,'parent','fr');
  p2:=public.present_legal_document(doc,parent_id,child_b,'parent','fr');
  failed:=false;
  begin perform public.decide_legal_document(p1,parent_id,'authorized',gen_random_uuid(),'');
  exception when others then failed:=sqlerrm='Confirmation required'; end;
  insert into parent_authorization_checks values('default_still_requires_code',failed);
  update public.legal_parent_code_control set required=false,updated_at=now() where singleton;
  decision_id:=public.decide_legal_document(p1,parent_id,'authorized',key1,'');
  insert into parent_authorization_checks select 'waiver_is_explicit_in_immutable_evidence',
    authority_snapshot->>'confirmation_method'='temporarily_waived' and authority_snapshot->>'parent_email_confirmed'='true'
    from public.legal_decisions where id=decision_id;
  insert into public.legal_representative_assertions(guardian_id,child_id,club_id,status,basis)
    values(parent_id,child_b,club_a,'verified','TEST ONLY');
  perform public.configure_legal_audience(other_doc,(select applicability from public.legal_documents where id=other_doc),admin_id);
  update public.legal_drafts set translations=tr,allowed_variables=array['child_name','club_name'],change_summary='Test fictif'
    where document_id=other_doc;
  perform public.publish_legal_draft(other_doc,admin_id);
  update public.legal_documents set active=true where id=other_doc;
  p_ai:=public.present_legal_document(other_doc,parent_id,child_b,'parent','fr');
  failed:=false;
  begin perform public.decide_legal_document(p_ai,parent_id,'consented',gen_random_uuid(),'');
  exception when others then failed:=sqlerrm='Confirmation required'; end;
  insert into parent_authorization_checks values('optional_ai_still_requires_code',failed);
  insert into parent_authorization_checks select 'first_child_granted',player_consent_status='granted'
    from public.club_members where club_id=club_a and user_id=child_a;
  insert into parent_authorization_checks select 'second_child_still_pending',player_consent_status='pending'
    from public.club_members where club_id=club_a and user_id=child_b;
  insert into parent_authorization_checks select 'other_club_still_pending',player_consent_status='pending'
    from public.club_members where club_id=club_b and user_id=child_a;
  select count(*) into count_before from public.player_consent_history where player_user_id=child_a;
  perform public.decide_legal_document(p1,parent_id,'authorized',key1,'');
  insert into parent_authorization_checks select 'retry_is_idempotent',count(*)=count_before
    from public.player_consent_history where player_user_id=child_a;
  insert into parent_authorization_checks select 'second_child_stays_pending_without_decision',player_consent_status='pending'
    from public.club_members where club_id=club_a and user_id=child_b;
  failed:=false;
  begin perform public.present_legal_document(doc,admin_id,child_a,'parent','fr');
  exception when others then failed:=sqlerrm='Forbidden'; end;
  insert into parent_authorization_checks values('unlinked_actor_denied',failed);
  p3:=public.present_legal_document(doc,parent_id,child_a,'parent','fr');
  perform public.decide_legal_document(p2,parent_id,'refused',gen_random_uuid(),'');
  insert into parent_authorization_checks select 'second_child_refusal_is_scoped',player_consent_status='granted'
    from public.club_members where club_id=club_a and user_id=child_a;
  perform public.publish_legal_draft(doc,admin_id);
  insert into parent_authorization_checks select 'new_version_requires_authorization',player_consent_status='pending'
    from public.club_members where club_id=club_a and user_id=child_a;
  insert into parent_authorization_checks select 'new_version_preserves_refusal',player_consent_status='refused'
    from public.club_members where club_id=club_a and user_id=child_b;
  failed:=false;
  begin perform public.decide_legal_document(p3,parent_id,'authorized',gen_random_uuid(),'');
  exception when others then failed:=sqlerrm='Legal version changed'; end;
  insert into parent_authorization_checks values('stale_presentation_denied',failed);
  insert into public.legal_representative_assertions(guardian_id,child_id,club_id,status,basis)
    values(parent_id,child_a,club_a,'revoked','TEST ONLY');
  insert into parent_authorization_checks values('revoked_authority_denied',not public.legal_document_actor_allowed(doc,parent_id,child_a,'parent'));
  failed:=false;
  begin perform public.grant_player_consent_transactional(child_b,parent_id);
  exception when others then failed:=sqlerrm='VERSIONED_PARENT_AUTHORIZATION_REQUIRED'; end;
  insert into parent_authorization_checks values('old_client_grant_denied',failed);
  update public.legal_parent_code_control set required=true,updated_at=now() where singleton;
  insert into parent_authorization_checks select 'toggle_reenabled',required from public.legal_parent_code_control where singleton;
  if exists(select 1 from parent_authorization_checks where ok is distinct from true) then raise exception 'Parent fixture failed'; end if;
end $$;
select * from parent_authorization_checks order by item;
rollback;
