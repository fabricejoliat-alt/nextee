-- Read-only postflight after 20261029_legal_om_ranking_rpc_gate.sql on isolated TEST.
with functions(signature,kind) as (values
  ('public.om_ranking_snapshot(uuid,date)','wrapper'),
  ('public.om_ranking_snapshot(uuid,date,date)','wrapper'),
  ('public.om_ranking_snapshot_legacy_business(uuid,date)','business'),
  ('public.om_ranking_snapshot_business(uuid,date,date)','business'))
select f.signature,f.kind,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  case when f.kind='wrapper' then position('legal_required_direct_access' in pg_get_functiondef(p.oid))>0 else null end as checks_legal_gate,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;
