-- Read-only postflight after 20261022_legal_template_rendering.sql on isolated TEST.
select current_database() as database_name,
  to_regprocedure('public.legal_template_variables(text)') as parser_rpc,
  to_regprocedure('public.legal_template_is_valid(text,text[])') as validation_rpc,
  to_regprocedure('public.set_legal_draft_variables(uuid,integer,text[],uuid)') as draft_rpc,
  to_regprocedure('public.publish_legal_draft(uuid,uuid)') as publication_rpc,
  to_regprocedure('public.present_legal_document(uuid,uuid,uuid,text,text)') as presentation_rpc;

select public.legal_template_variables('{{child_name}} et {{child_name}} / {{club_name}}')
  = array['child_name','child_name','club_name'] as duplicates_preserved,
  public.legal_template_is_valid('{{child_name}}',array['child_name']) as reviewed_accepted,
  not public.legal_template_is_valid('{{email}}',array['child_name']) as unknown_rejected,
  not public.legal_template_is_valid('{{child-name}}',array['child_name']) as malformed_rejected;

select proname,prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',oid,'EXECUTE') as service_execute
from pg_proc where oid in (
  'public.legal_template_variables(text)'::regprocedure,
  'public.legal_template_is_valid(text,text[])'::regprocedure,
  'public.set_legal_draft_variables(uuid,integer,text[],uuid)'::regprocedure,
  'public.publish_legal_draft(uuid,uuid)'::regprocedure,
  'public.present_legal_document(uuid,uuid,uuid,text,text)'::regprocedure)
order by proname;

select count(*) as active_legal_documents from public.legal_documents where active;
