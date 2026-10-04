-- Read-only postflight after 20261025_legal_reviewed_publication.sql on isolated TEST.
select current_database() as database_name,
  to_regprocedure('public.publish_legal_draft_checked(uuid,uuid,jsonb)') as reviewed_publication_rpc,
  has_function_privilege('anon','public.publish_legal_draft_checked(uuid,uuid,jsonb)','EXECUTE') as anon_execute,
  has_function_privilege('authenticated','public.publish_legal_draft_checked(uuid,uuid,jsonb)','EXECUTE') as authenticated_execute,
  has_function_privilege('service_role','public.publish_legal_draft_checked(uuid,uuid,jsonb)','EXECUTE') as service_execute,
  (select count(*) from public.legal_documents where active) as active_legal_documents;
