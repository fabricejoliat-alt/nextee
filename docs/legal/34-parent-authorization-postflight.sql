-- READ ONLY. Run after 20261107 on TEST.
select 'document_guard_service_only' item, has_function_privilege('service_role',
  'public.legal_document_actor_allowed(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated','public.legal_document_actor_allowed(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.legal_document_actor_allowed(uuid,uuid,uuid,text)','execute') ok
union all select 'linked_authority_distinct', exists(select 1 from pg_constraint
  where conrelid='public.legal_presentations'::regclass and pg_get_constraintdef(oid) like '%club_linked_parent%')
union all select 'decision_sync_trigger', exists(select 1 from pg_trigger where tgrelid='public.legal_current_state'::regclass
  and tgname='sync_parent_authorization_access' and not tgisinternal)
union all select 'new_version_trigger', exists(select 1 from pg_trigger where tgrelid='public.legal_versions'::regclass
  and tgname='parent_authorization_new_version' and not tgisinternal)
union all select 'activation_trigger', exists(select 1 from pg_trigger where tgrelid='public.legal_documents'::regclass
  and tgname='parent_authorization_activated' and not tgisinternal)
union all select 'legacy_grant_closed', position('VERSIONED_PARENT_AUTHORIZATION_REQUIRED' in
  pg_get_functiondef('public.grant_player_consent_transactional(uuid,uuid,text,text)'::regprocedure))>0
union all select 'present_uses_document_guard', position('legal_document_actor_allowed' in
  pg_get_functiondef('public.present_legal_document(uuid,uuid,uuid,text,text)'::regprocedure))>0
union all select 'decide_uses_document_guard', position('legal_document_actor_allowed' in
  pg_get_functiondef('public.decide_legal_document(uuid,uuid,text,uuid,text)'::regprocedure))>0
union all select 'challenge_uses_document_guard', position('legal_document_actor_allowed' in
  pg_get_functiondef('public.issue_legal_parent_challenge(uuid,uuid,text,text)'::regprocedure))>0
union all select 'ai_verified_rep_guard_preserved', position('legal_representative_assertions' in
  pg_get_functiondef('public.legal_actor_allowed(uuid,uuid,uuid,text)'::regprocedure))>0
order by item;
