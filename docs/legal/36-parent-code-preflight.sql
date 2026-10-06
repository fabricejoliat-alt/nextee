-- READ ONLY. Supabase TEST wizbeuuvjibmmuxyynly, after 20261107.
select 'unified_parent_guard_present' item,
  to_regprocedure('public.legal_document_actor_allowed(uuid,uuid,uuid,text)') is not null ok
union all select 'parent_code_control_absent',to_regclass('public.legal_parent_code_control') is null
union all select 'parent_access_sync_present',exists(select 1 from pg_trigger
  where tgrelid='public.legal_current_state'::regclass and tgname='sync_parent_authorization_access')
union all select 'challenge_rpc_present',to_regprocedure('public.issue_legal_parent_challenge(uuid,uuid,text,text)') is not null
union all select 'old_client_grant_closed',position('VERSIONED_PARENT_AUTHORIZATION_REQUIRED' in
  pg_get_functiondef('public.grant_player_consent_transactional(uuid,uuid,text,text)'::regprocedure))>0
order by item;
