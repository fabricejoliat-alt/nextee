-- READ ONLY. Supabase TEST wizbeuuvjibmmuxyynly only.
select 'authority_constraint_present' item, exists(select 1 from pg_constraint
  where conrelid='public.legal_presentations'::regclass and conname='legal_presentations_authority_check') ok
union all select 'new_batch_not_applied', to_regprocedure('public.legal_document_actor_allowed(uuid,uuid,uuid,text)') is null
union all select 'presentation_rpc_present', to_regprocedure('public.present_legal_document(uuid,uuid,uuid,text,text)') is not null
union all select 'decision_rpc_present', to_regprocedure('public.decide_legal_document(uuid,uuid,text,uuid,text)') is not null
union all select 'challenge_rpc_present', to_regprocedure('public.issue_legal_parent_challenge(uuid,uuid,text,text)') is not null
union all select 'legacy_grant_service_only', not has_function_privilege('authenticated',
  'public.grant_player_consent_transactional(uuid,uuid,text,text)','execute')
order by item;

-- Existing user-approved activation is observed, never changed by this batch.
select enabled from public.legal_enforcement_control where singleton;
select document_key,club_id,active,
  (select max(version_number) from public.legal_versions v where v.document_id=d.id) latest_version
from public.legal_documents d where purpose_key='service.parent_authorization' order by document_key;
