-- Read-only TEST postflight after 20261104_legal_shared_draft_text.sql.
select p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p where p.oid in (
  to_regprocedure('public.save_legal_draft_text_checked(jsonb,text,text,text,text,text,uuid)'),
  to_regprocedure('public.approve_legal_draft_translation_checked(uuid,text,jsonb,uuid)'));

select (select enabled from public.legal_enforcement_control limit 1) as enforcement_enabled,
  (select count(*) from public.legal_documents where active) as active_documents,
  (select count(*) from public.legal_documents where document_key ~ '^activitee_') as activitee_documents,
  (select count(*) from public.legal_versions v join public.legal_documents d on d.id=v.document_id
    where d.document_key ~ '^activitee_') as activitee_versions;
