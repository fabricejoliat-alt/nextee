-- Read-only postflight after 20261030_legal_manager_mutation_rpc_gate.sql on isolated TEST.
with functions(signature,kind) as (values
  ('public.coach_group_delete_keep_history(uuid)','wrapper'),
  ('public.coach_group_delete_keep_history_business(uuid)','business'),
  ('public.write_manager_om_v1(uuid,uuid,text,text,uuid,text,jsonb)','wrapper'),
  ('public.write_manager_om_v1_business(uuid,uuid,text,text,uuid,text,jsonb)','business'))
select f.signature,f.kind,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  case when f.kind='wrapper' then position('legal_required_' in pg_get_functiondef(p.oid))>0 else null end as checks_legal_gate,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;
