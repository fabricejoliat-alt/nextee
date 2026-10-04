-- Read-only postflight after 20261031_legal_event_edit_rpc_gate.sql on isolated TEST.
with functions(signature,kind) as (values
  ('public.update_coach_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)','wrapper'),
  ('public.update_coach_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb)','business'),
  ('public.update_coach_event_series_v1(uuid,jsonb,uuid[],uuid[],jsonb)','wrapper'),
  ('public.update_coach_event_series_v1_business(uuid,jsonb,uuid[],uuid[],jsonb)','business'),
  ('public.update_manager_event_occurrence_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])','wrapper'),
  ('public.update_manager_event_occurrence_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[])','business'),
  ('public.update_manager_event_series_v1(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)','wrapper'),
  ('public.update_manager_event_series_v1_business(uuid,jsonb,jsonb,uuid[],uuid[],jsonb,uuid[],text)','business'))
select f.signature,f.kind,p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
  case when f.kind='wrapper' then position('legal_required_event_access' in pg_get_functiondef(p.oid))>0 else null end as checks_event_gate,
  (select enabled from public.legal_enforcement_control where singleton=true) as legal_gate_enabled,
  (select count(*) from public.legal_documents where active) as active_legal_documents
from functions f left join pg_proc p on p.oid=to_regprocedure(f.signature)
order by f.signature;
